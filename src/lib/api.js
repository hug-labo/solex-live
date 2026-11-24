// Accès au serveur de course.
//  * Supabase si VITE_SUPABASE_URL et VITE_SUPABASE_KEY sont définis (fichier .env.local ou Render) ;
//  * sinon « mode test local » : tout est stocké dans ce navigateur (plusieurs onglets peuvent
//    communiquer, mais pas plusieurs appareils). Pratique pour essayer sans compte.
//
// Format d'un point échangé : [t, lat, lon, speed, heading, acc]

const URL_ = import.meta.env?.VITE_SUPABASE_URL?.replace(/\/+$/, '');
const KEY = import.meta.env?.VITE_SUPABASE_KEY;

export function createSupabaseApi(url, key, fetchFn = (...a) => fetch(...a)) {
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // ancienne clé « anon » (JWT)

  async function rpc(fn, args) {
    let res;
    try {
      res = await fetchFn(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch {
      throw new Error('Serveur injoignable (réseau ?)');
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.message || `Erreur serveur ${res.status}`);
    return data;
  }

  return {
    kind: 'supabase',
    async createSession(name, circuit) {
      const r = await rpc('create_session', { p_name: name, p_circuit: circuit });
      return { id: r.id, writeKey: r.write_key };
    },
    getSession: (id) => rpc('get_session', { p_id: id }),
    updateCircuit: (id, key_, circuit) => rpc('update_circuit', { p_id: id, p_key: key_, p_circuit: circuit }),
    pushPoints: (id, key_, points) => rpc('push_points', { p_id: id, p_key: key_, p_points: points }),
    getPoints: (id, after = -1, limit = 5000) => rpc('get_points', { p_id: id, p_after: after, p_limit: limit }),
  };
}

export function createLocalApi(storage = globalThis.localStorage) {
  const read = (k, d) => {
    try { return JSON.parse(storage.getItem(k)) ?? d; } catch { return d; }
  };
  const write = (k, v) => storage.setItem(k, JSON.stringify(v));
  const sessKey = (id) => 'solex.local.session.' + id;
  const ptsKey = (id) => 'solex.local.points.' + id;
  const uuid = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const check = (id, key) => {
    const s = read(sessKey(id), null);
    if (!s || s.write_key !== key) throw new Error('Clé de course invalide');
    return s;
  };

  return {
    kind: 'local',
    async createSession(name, circuit) {
      const s = { id: uuid(), write_key: uuid(), name, circuit, created_at: new Date().toISOString() };
      write(sessKey(s.id), s);
      write(ptsKey(s.id), []);
      return { id: s.id, writeKey: s.write_key };
    },
    async getSession(id) {
      const s = read(sessKey(id), null);
      return s && { id: s.id, name: s.name, circuit: s.circuit, created_at: s.created_at };
    },
    async updateCircuit(id, key, circuit) {
      const s = check(id, key);
      write(sessKey(id), { ...s, circuit });
    },
    async pushPoints(id, key, points) {
      check(id, key);
      const all = read(ptsKey(id), []);
      const seen = new Set(all.map((p) => p[0]));
      const fresh = points.filter((p) => !seen.has(p[0]));
      write(ptsKey(id), [...all, ...fresh].sort((a, b) => a[0] - b[0]));
      return fresh.length;
    },
    async getPoints(id, after = -1, limit = 5000) {
      return read(ptsKey(id), []).filter((p) => p[0] > after).slice(0, Math.min(limit, 5000));
    },
  };
}

let api;
export function getApi() {
  api ??= URL_ && KEY ? createSupabaseApi(URL_, KEY) : createLocalApi();
  return api;
}

// ---------- liens de course ----------
// Les identifiants sont placés après « # » : ils ne sont jamais envoyés à l'hébergeur du site.

export function sessionLinks(sid, key) {
  const base = location.origin + location.pathname;
  return {
    stand: key ? `${base}#s=${sid}&k=${key}` : null,
    phone: key ? `${base}#s=${sid}&k=${key}&mode=emetteur` : null,
    viewer: `${base}#s=${sid}`,
  };
}

/** Lit un lien (ou le hash courant) : { sid, key, mode } ou null. */
export function parseSessionLink(text = location.hash) {
  const i = text.indexOf('#');
  const params = new URLSearchParams(i >= 0 ? text.slice(i + 1) : text);
  const sid = params.get('s');
  if (!sid) return null;
  return { sid, key: params.get('k') || null, mode: params.get('mode') || null };
}

/** Points du serveur → points du moteur de suivi. */
export const toGpsPoint = (p) => ({ t: p[0], lat: p[1], lon: p[2], speed: p[3], heading: p[4], acc: p[5] });
