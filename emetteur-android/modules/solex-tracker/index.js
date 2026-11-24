import { requireNativeModule } from 'expo-modules-core';

const Native = requireNativeModule('SolexTracker');

/** Démarre le service natif (GPS + envoi), qui continue écran éteint. */
export const start = (sid, key, name, url, apikey) => Native.start(sid, key, name, url, apikey);
/** Arrête le service (les points en attente sont envoyés une dernière fois). */
export const stop = () => Native.stop();
/** { running, lastFix, acc, speed, lastOk, error, pending, sent } */
export const getStatus = () => Native.getStatus();
