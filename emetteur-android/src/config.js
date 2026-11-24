// Serveur Supabase de Solex Live (clé PUBLIQUE : elle peut figurer dans l'application).
export const SUPABASE_URL = 'https://cashormlaqzfkuwscusv.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_gqwkkuiSVecUaT8QYGHBvA_NKTuBFZZ';

export const LOCATION_TASK = 'solex-location';
export const MIN_INTERVAL_MS = 900; // ~1 point par seconde
export const MAX_ACC_M = 50; // points trop imprécis ignorés
export const BATCH = 300;
export const MAX_QUEUE = 200000; // ~55 h à 1 Hz
