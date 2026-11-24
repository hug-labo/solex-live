package fr.solexlive.tracker

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SolexTrackerModule : Module() {
  private val context
    get() = requireNotNull(appContext.reactContext) { "Contexte Android indisponible" }

  override fun definition() = ModuleDefinition {
    Name("SolexTracker")

    Function("start") { sid: String, key: String, name: String, url: String, apikey: String ->
      val intent = Intent(context, TrackerService::class.java)
        .putExtra("sid", sid)
        .putExtra("key", key)
        .putExtra("name", name)
        .putExtra("url", url)
        .putExtra("apikey", apikey)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    Function("stop") {
      context.stopService(Intent(context, TrackerService::class.java))
    }

    Function("getStatus") {
      mapOf(
        "running" to TrackerService.running,
        "lastFix" to TrackerService.lastFix.toDouble(),
        "acc" to TrackerService.acc,
        "speed" to TrackerService.speed,
        "lastOk" to TrackerService.lastOk.toDouble(),
        "error" to TrackerService.error,
        "pending" to TrackerService.pending(),
        "sent" to TrackerService.sent.toDouble(),
      )
    }
  }
}
