import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Linking, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Tracker from './modules/solex-tracker';
import { getSession, parseSessionLink } from './src/api';
import { loadSession, saveSession } from './src/session';
import { SUPABASE_KEY, SUPABASE_URL } from './src/config';

const C = {
  bg: '#0f1115', card: '#1e222b', line: '#2c323d', text: '#eef1f6', muted: '#9aa3b2',
  green: '#2bd47d', red: '#ff3b3b', yellow: '#ffcf4a', orange: '#ff7a1a',
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = chargement, null = aucune
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState('');

  // L'état vient du service natif (il tourne même quand cet écran est fermé).
  const refresh = useCallback(() => {
    try { setStatus(Tracker.getStatus()); } catch { /* module indisponible */ }
  }, []);
  const running = !!status?.running;

  useEffect(() => {
    loadSession().then(setSession);
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const stopTracking = () => { Tracker.stop(); setTimeout(refresh, 300); };

  const pair = async (text) => {
    const link = parseSessionLink(text);
    if (!link) { setMsg('Ce QR code n\'est pas un lien téléphone Solex Live.'); return; }
    setScanning(false);
    setMsg('Connexion à la course…');
    try {
      const s = await getSession(link.sid);
      if (!s) { setMsg('Course introuvable sur le serveur.'); return; }
      if (running) stopTracking();
      const next = { sid: link.sid, key: link.key, name: s.name || s.circuit?.name || 'Course' };
      await saveSession(next);
      setSession(next);
      setMsg('');
    } catch (e) {
      setMsg(e.message);
    }
  };

  const start = async () => {
    setMsg('');
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      setMsg('La localisation est refusée. Autorisez-la dans les réglages de l\'application.');
      return;
    }
    // « Toujours » : permet à Android de relancer l'émission s'il a dû l'arrêter.
    const bg0 = await Location.getBackgroundPermissionsAsync();
    if (bg0.status !== 'granted') {
      const ok = await new Promise((resolve) => Alert.alert(
        'Localisation « Toujours »',
        'Recommandé : choisissez « Toujours autoriser » sur l\'écran suivant, puis revenez dans l\'application.',
        [{ text: 'Plus tard', style: 'cancel', onPress: () => resolve(false) }, { text: 'Continuer', onPress: () => resolve(true) }],
      ));
      if (ok) await Location.requestBackgroundPermissionsAsync();
    }
    // Android 13+ : autorisation d'afficher la notification « émission en cours ».
    if (Platform.OS === 'android' && Platform.Version >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS');
    }
    try {
      Tracker.start(session.sid, session.key, session.name, SUPABASE_URL, SUPABASE_KEY);
      setTimeout(refresh, 500);
    } catch (e) {
      setMsg('Démarrage impossible : ' + e.message);
    }
  };

  const stop = () => Alert.alert('Arrêter l\'émission ?', 'Le stand verra une perte de signal.', [
    { text: 'Annuler', style: 'cancel' },
    { text: 'Arrêter', style: 'destructive', onPress: stopTracking },
  ]);

  const leave = () => Alert.alert('Changer de course ?', 'L\'émission vers la course actuelle sera arrêtée.', [
    { text: 'Annuler', style: 'cancel' },
    {
      text: 'Changer', style: 'destructive',
      onPress: async () => { if (running) stopTracking(); await saveSession(null); setSession(null); },
    },
  ]);

  const battery = async () => {
    try {
      await IntentLauncher.startActivityAsync('android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', { data: 'package:fr.solexlive.emetteur' });
    } catch {
      try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
      } catch {
        Linking.openSettings();
      }
    }
  };

  if (session === undefined) return <View style={s.screen} />;

  if (scanning) return <Scanner onCode={pair} onCancel={() => setScanning(false)} />;

  if (!session) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.content}>
        <StatusBar style="light" />
        <Text style={s.h1}>Solex Émetteur</Text>
        <Text style={s.p}>
          Sur le PC du stand (solex-live.onrender.com), créez la course puis ouvrez « Appairer le téléphone embarqué ».
        </Text>
        <Big label="📷  SCANNER LE QR CODE" color={C.green} onPress={() => { setMsg(''); setScanning(true); }} />
        <PasteLink onSubmit={pair} />
        {!!msg && <Text style={s.err}>{msg}</Text>}
      </ScrollView>
    );
  }

  const now = Date.now();
  const age = (t) => (t ? Math.max(0, Math.round((now - t) / 1000)) : null);
  const fixAge = age(status?.lastFix);
  const okAge = age(status?.lastOk);
  const netOk = okAge != null && okAge < 10 && !status?.error;
  const gpsOk = fixAge != null && fixAge < 5;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <StatusBar style="light" />
      <Text style={s.h1}>Solex Émetteur</Text>
      <Text style={s.course}>{session.name}</Text>

      {running ? (
        <View style={[s.state, { backgroundColor: netOk && gpsOk ? '#123d2a' : '#4a3a12' }]}>
          <Text style={[s.stateTxt, { color: netOk && gpsOk ? C.green : C.yellow }]}>
            {netOk && gpsOk ? 'ÉMISSION EN COURS' : !gpsOk ? 'RECHERCHE GPS…' : 'RÉSEAU COUPÉ — POINTS GARDÉS'}
          </Text>
          <Text style={s.stateSub}>Vous pouvez éteindre l'écran.</Text>
        </View>
      ) : (
        <Big label="▶  DÉMARRER L'ÉMISSION" color={C.green} onPress={start} />
      )}

      <View style={s.card}>
        <Row k="GPS" v={status?.lastFix
          ? `±${Math.round(status.acc ?? 0)} m${status.speed >= 0 ? ` · ${Math.round(status.speed * 3.6)} km/h` : ''}${fixAge > 3 ? ` · il y a ${fixAge} s` : ''}`
          : running ? 'recherche du signal…' : '—'} />
        <Row k="Réseau" v={status?.error ? status.error : okAge != null ? `OK · dernier envoi il y a ${okAge} s` : '—'} bad={!!status?.error} />
        <Row k="En attente" v={`${status?.pending ?? 0} point(s)`} />
        <Row k="Envoyés" v={String(status?.sent ?? 0)} />
      </View>

      {!!msg && <Text style={s.err}>{msg}</Text>}

      <View style={s.card}>
        <Text style={s.cardTitle}>Avant la course</Text>
        <Text style={s.p}>• Téléphone branché sur une batterie.</Text>
        <Text style={s.p}>• Ne fermez pas l'application depuis la liste des applis récentes.</Text>
        <Small label="Désactiver l'économie de batterie pour l'appli" onPress={battery} />
      </View>

      {running && <Big label="■  Arrêter" color={C.red} outline onPress={stop} />}
      <Small label="Changer de course (scanner un autre QR code)" onPress={leave} />
    </ScrollView>
  );
}

function Scanner({ onCode, onCancel }) {
  const [perm, requestPerm] = useCameraPermissions();
  const done = useRef(false);
  if (!perm) return <View style={s.screen} />;
  if (!perm.granted) {
    return (
      <View style={[s.screen, s.content]}>
        <Text style={s.p}>L'appareil photo sert uniquement à lire le QR code de la course.</Text>
        <Big label="Autoriser l'appareil photo" color={C.green} onPress={requestPerm} />
        <Small label="Annuler" onPress={onCancel} />
      </View>
    );
  }
  return (
    <View style={s.screen}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          done.current = true;
          onCode(data);
        }}
      />
      <View style={s.scanBar}>
        <Text style={s.p}>Visez le QR code affiché sur le PC du stand.</Text>
        <Small label="Annuler" onPress={onCancel} />
      </View>
    </View>
  );
}

function PasteLink({ onSubmit }) {
  const [text, setText] = useState('');
  return (
    <View style={s.card}>
      <Text style={s.muted}>…ou collez le lien téléphone :</Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={setText}
        placeholder="https://solex-live.onrender.com/#s=…"
        placeholderTextColor={C.muted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Small label="Valider le lien" onPress={() => onSubmit(text.trim())} />
    </View>
  );
}

const Big = ({ label, color, onPress, outline }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.big, outline ? { borderColor: color, borderWidth: 2 } : { backgroundColor: color }, pressed && { opacity: 0.7 }]}
  >
    <Text style={[s.bigTxt, { color: outline ? color : '#000' }]}>{label}</Text>
  </Pressable>
);

const Small = ({ label, onPress }) => (
  <Pressable onPress={onPress} style={({ pressed }) => [s.small, pressed && { opacity: 0.6 }]}>
    <Text style={s.smallTxt}>{label}</Text>
  </Pressable>
);

const Row = ({ k, v, bad }) => (
  <View style={s.row}>
    <Text style={s.rowK}>{k}</Text>
    <Text style={[s.rowV, bad && { color: C.red }]}>{v}</Text>
  </View>
);

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { padding: 18, paddingTop: 56, gap: 14 },
  h1: { color: C.text, fontSize: 26, fontWeight: '900' },
  course: { color: C.orange, fontSize: 18, fontWeight: '700', marginTop: -6 },
  p: { color: C.text, fontSize: 15, lineHeight: 22 },
  muted: { color: C.muted, fontSize: 14 },
  err: { color: '#fff', backgroundColor: C.red, padding: 12, borderRadius: 10, fontWeight: '700', overflow: 'hidden' },
  big: { borderRadius: 14, paddingVertical: 24, alignItems: 'center' },
  bigTxt: { fontSize: 20, fontWeight: '900' },
  small: { borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: C.card },
  smallTxt: { color: C.text, fontSize: 15 },
  card: { backgroundColor: C.card, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 14, gap: 10 },
  cardTitle: { color: C.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  rowK: { color: C.muted, fontSize: 16 },
  rowV: { color: C.text, fontSize: 16, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  state: { borderRadius: 14, padding: 20, alignItems: 'center', gap: 4 },
  stateTxt: { fontSize: 20, fontWeight: '900' },
  stateSub: { color: C.muted },
  input: { color: C.text, borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  scanBar: { padding: 18, paddingBottom: 40, gap: 10, backgroundColor: C.bg },
});
