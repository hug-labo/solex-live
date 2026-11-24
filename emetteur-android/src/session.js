// Course mémorisée sur le téléphone (pour relancer l'émission après un redémarrage).
import AsyncStorage from '@react-native-async-storage/async-storage';

const K = 'solex.session'; // { sid, key, name }

export async function loadSession() {
  try { return JSON.parse(await AsyncStorage.getItem(K)); } catch { return null; }
}

export async function saveSession(s) {
  if (s) await AsyncStorage.setItem(K, JSON.stringify(s));
  else await AsyncStorage.removeItem(K);
}
