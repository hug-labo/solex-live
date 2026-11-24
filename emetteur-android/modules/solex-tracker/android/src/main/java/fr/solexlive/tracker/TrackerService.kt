package fr.solexlive.tracker

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

/**
 * Service au premier plan (notification permanente) qui :
 *  - lit le GPS chaque seconde ;
 *  - garde les points dans une file (copiée dans un fichier : rien n'est perdu si le service redémarre) ;
 *  - envoie la file au serveur chaque seconde, par paquets, sur son propre fil d'exécution.
 * Il ne dépend pas de la partie JavaScript : il continue écran éteint et application en arrière-plan.
 */
class TrackerService : Service(), LocationListener {

  companion object {
    private const val CHANNEL = "solex-tracker"
    private const val NOTIF_ID = 4242
    private const val PREFS = "solex_tracker"
    private const val MIN_INTERVAL_MS = 900L
    private const val MAX_ACC_M = 50f
    private const val BATCH = 300
    private const val MAX_QUEUE = 200_000

    @Volatile var running = false
    @Volatile var lastFix = 0L // heure de réception du dernier point GPS (horloge du téléphone)
    @Volatile var acc = -1.0
    @Volatile var speed = -1.0
    @Volatile var lastOk = 0L
    @Volatile var error: String? = null
    @Volatile var sent = 0L

    /** Points en attente : [t, lat, lon, vitesse, cap, précision] (NaN = inconnu). */
    val queue = ArrayList<DoubleArray>()
    fun pending(): Int = synchronized(queue) { queue.size }
  }

  private lateinit var lm: LocationManager
  private var exec: ScheduledExecutorService? = null
  private var wake: PowerManager.WakeLock? = null
  private var sid = ""
  private var key = ""
  private var url = ""
  private var apikey = ""
  private var name = ""
  private var lastT = -1L
  @Volatile private var dirty = false

  private val queueFile by lazy { File(filesDir, "solex_queue.csv") }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    lm = getSystemService(LOCATION_SERVICE) as LocationManager
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
    val newSid = intent?.getStringExtra("sid")
    if (newSid != null) {
      if (newSid != prefs.getString("sid", null)) {
        // Nouvelle course : on repart d'une file vide.
        synchronized(queue) { queue.clear() }
        queueFile.delete()
        prefs.edit().putLong("sent", 0).apply()
      }
      prefs.edit()
        .putString("sid", newSid)
        .putString("key", intent.getStringExtra("key"))
        .putString("name", intent.getStringExtra("name"))
        .putString("url", intent.getStringExtra("url"))
        .putString("apikey", intent.getStringExtra("apikey"))
        .apply()
    }
    sid = prefs.getString("sid", "") ?: ""
    key = prefs.getString("key", "") ?: ""
    name = prefs.getString("name", "") ?: ""
    url = (prefs.getString("url", "") ?: "").trimEnd('/')
    apikey = prefs.getString("apikey", "") ?: ""
    sent = prefs.getLong("sent", 0)

    startInForeground()
    if (sid.isEmpty() || key.isEmpty() || url.isEmpty()) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!running) {
      loadQueue()
      startGps()
      wake = (getSystemService(POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "solex:tracker")
        .apply { setReferenceCounted(false); acquire() }
      exec = Executors.newSingleThreadScheduledExecutor().also {
        it.scheduleWithFixedDelay({ flushSafe() }, 1, 1, TimeUnit.SECONDS)
      }
      running = true
    }
    return START_STICKY // Android relance le service s'il l'a arrêté
  }

  override fun onDestroy() {
    running = false
    try { lm.removeUpdates(this) } catch (_: Exception) {}
    exec?.let {
      it.execute { flushSafe() } // dernier envoi des points restants
      it.shutdown()
    }
    exec = null
    wake?.let { if (it.isHeld) it.release() }
    wake = null
    super.onDestroy()
  }

  // ---------- notification ----------

  private fun startInForeground() {
    val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Émission de la position", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL)
    else Notification.Builder(this)
    val notif = builder
      .setContentTitle("Solex Live — émission en cours")
      .setContentText(if (name.isNotEmpty()) "Course : $name" else "Position envoyée au stand")
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  // ---------- GPS ----------

  @SuppressLint("MissingPermission")
  private fun startGps() {
    try {
      lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper())
    } catch (e: SecurityException) {
      error = "Localisation non autorisée"
    } catch (e: IllegalArgumentException) {
      error = "GPS indisponible sur ce téléphone"
    }
  }

  override fun onLocationChanged(loc: Location) {
    lastFix = System.currentTimeMillis()
    acc = if (loc.hasAccuracy()) loc.accuracy.toDouble() else -1.0
    speed = if (loc.hasSpeed()) loc.speed.toDouble() else -1.0
    val t = loc.time
    if (t <= lastT || t - lastT < MIN_INTERVAL_MS) return
    if (loc.hasAccuracy() && loc.accuracy > MAX_ACC_M) return
    lastT = t
    val p = doubleArrayOf(
      t.toDouble(), loc.latitude, loc.longitude,
      if (loc.hasSpeed()) loc.speed.toDouble() else Double.NaN,
      if (loc.hasBearing()) loc.bearing.toDouble() else Double.NaN,
      if (loc.hasAccuracy()) loc.accuracy.toDouble() else Double.NaN,
    )
    synchronized(queue) {
      queue.add(p)
      if (queue.size > MAX_QUEUE) queue.subList(0, queue.size - MAX_QUEUE).clear()
    }
    dirty = true
  }

  // Anciennes versions d'Android : ces méthodes doivent exister.
  @Deprecated("") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
  override fun onProviderEnabled(provider: String) { if (error == "GPS désactivé") error = null }
  override fun onProviderDisabled(provider: String) { error = "GPS désactivé" }

  // ---------- envoi ----------

  private fun flushSafe() {
    try { flush() } catch (e: Exception) { error = e.message ?: "Erreur" }
    if (dirty) saveQueue()
  }

  private fun flush() {
    while (true) {
      val batch = synchronized(queue) { ArrayList(queue.subList(0, minOf(BATCH, queue.size))) }
      if (batch.isEmpty()) return
      val body = StringBuilder()
        .append("{\"p_id\":\"").append(sid).append("\",\"p_key\":\"").append(key).append("\",\"p_points\":[")
      batch.forEachIndexed { i, p ->
        if (i > 0) body.append(',')
        body.append('[').append(p[0].toLong()).append(',')
          .append(fmt(p[1], 7)).append(',').append(fmt(p[2], 7)).append(',')
          .append(fmt(p[3], 2)).append(',').append(fmt(p[4], 1)).append(',').append(fmt(p[5], 1)).append(']')
      }
      body.append("]}")

      val code: Int
      val conn = URL("$url/rest/v1/rpc/push_points").openConnection() as HttpURLConnection
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = 8000
        conn.readTimeout = 10000
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.setRequestProperty("apikey", apikey)
        if (apikey.startsWith("eyJ")) conn.setRequestProperty("Authorization", "Bearer $apikey")
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        code = conn.responseCode
        if (code !in 200..299) {
          val msg = conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
          error = Regex("\"message\"\\s*:\\s*\"([^\"]*)\"").find(msg)?.groupValues?.get(1) ?: "Erreur serveur $code"
          return
        }
        conn.inputStream.use { it.readBytes() }
      } catch (e: IOException) {
        error = "Pas de réseau"
        return
      } finally {
        conn.disconnect()
      }

      synchronized(queue) { queue.subList(0, minOf(batch.size, queue.size)).clear() }
      sent += batch.size
      lastOk = System.currentTimeMillis()
      error = null
      dirty = true
      getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("sent", sent).apply()
    }
  }

  private fun fmt(x: Double, d: Int): String =
    if (x.isNaN()) "null" else String.format(Locale.US, "%.${d}f", x)

  // ---------- file sur disque ----------

  private fun saveQueue() {
    dirty = false
    val snapshot = synchronized(queue) { ArrayList(queue) }
    try {
      val tmp = File(filesDir, "solex_queue.tmp")
      tmp.bufferedWriter().use { w ->
        for (p in snapshot) w.append(p.joinToString(",")).append('\n')
      }
      tmp.renameTo(queueFile)
    } catch (_: IOException) {}
  }

  private fun loadQueue() {
    if (!queueFile.exists()) return
    try {
      val loaded = queueFile.readLines().mapNotNull { line ->
        val v = line.split(',').map { it.toDoubleOrNull() ?: Double.NaN }
        if (v.size == 6 && !v[0].isNaN()) v.toDoubleArray() else null
      }
      synchronized(queue) {
        queue.clear()
        queue.addAll(loaded)
        lastT = queue.lastOrNull()?.get(0)?.toLong() ?: -1L
      }
    } catch (_: IOException) {}
  }
}
