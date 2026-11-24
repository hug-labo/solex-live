// Appels au serveur (mêmes fonctions que le site : voir supabase/schema.sql).
import { SUPABASE_KEY, SUPABASE_URL } from './config';

async function rpc(fn, args) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  } catch {
    throw new Error('Pas de réseau');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non JSON */ }
  if (!res.ok) throw new Error(data?.message || `Erreur serveur ${res.status}`);
  return data;
}

export const getSession = (id) => rpc('get_session', { p_id: id });
export const pushPoints = (id, key, points) => rpc('push_points', { p_id: id, p_key: key, p_points: points });

/** Lit un lien de course (QR code du PC stand) : { sid, key } ou null. */
export function parseSessionLink(text) {
  if (!text) return null;
  const i = text.indexOf('#');
  // Analyse à la main : URLSearchParams est incomplet dans React Native.
  const params = {};
  for (const part of (i >= 0 ? text.slice(i + 1) : text).split('&')) {
    const [k, v = ''] = part.split('=');
    params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  const sid = params.s;
  const key = params.k;
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!sid || !key || !uuid.test(sid) || !uuid.test(key)) return null;
  return { sid, key };
}
