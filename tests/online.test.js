import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceTracker } from '../src/lib/tracker.js';
import { createLocalApi, createSupabaseApi, parseSessionLink, toGpsPoint } from '../src/lib/api.js';
import { Uplink } from '../src/lib/uplink.js';
import { LiveSource } from '../src/lib/liveSource.js';
import { localProjection } from '../src/lib/geo.js';

const proj = localProjection([46.8, 2.4]);
const ll = (x, y) => proj.toLatLon({ x, y });
const circuit = {
  id: 'c1',
  name: 'test',
  track: [ll(-10, 0), ll(1000, 0)],
  startFinish: { a: ll(0, -10), b: ll(0, 10) },
  sectors: [],
  pit: [ll(500, -20), ll(600, -20), ll(600, 20), ll(500, 20)],
};

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// Aller-retour sur la ligne droite : SF à x=0, stands à x 500-600.
function course() {
  const pts = [];
  let t = 1_700_000_000_000;
  const add = (x, speed) => { const [lat, lon] = ll(x, 0); pts.push({ t, lat, lon, speed, heading: 90, acc: 3 }); t += 1000; };
  for (let lap = 0; lap < 3; lap++) {
    for (let x = -20; x <= 300; x += 20) add(x, 20);
    for (let x = 300; x >= -20; x -= 20) add(x, 20);
  }
  for (let x = -20; x <= 540; x += 20) add(x, 20); // vers les stands
  for (let i = 0; i < 15; i++) add(550, 0); // arrêt aux stands
  t += 20000; // trou de 20 s : perte de signal
  for (let x = 560; x <= 700; x += 20) add(x, 20);
  return pts;
}

test('replay = même résultat que le direct, et détecte les pertes de signal', () => {
  const pts = course();
  const direct = new RaceTracker(circuit);
  pts.forEach((p) => direct.push(p, p.t));
  const replayed = new RaceTracker(circuit);
  replayed.replay(pts);
  const a = direct.getSnapshot(), b = replayed.getSnapshot();
  assert.equal(b.laps.length, a.laps.length);
  assert.ok(b.laps.length >= 3);
  assert.deepEqual(b.laps.map((l) => l.time), a.laps.map((l) => l.time));
  assert.deepEqual(b.pitStops, a.pitStops);
  assert.equal(b.pitStops.length, 1);
  assert.ok(b.incidents.some((i) => i.type === 'signal'), 'trou de 20 s => incident perte de signal');
});

test('file d\'envoi : résiste aux coupures réseau et ne perd aucun point', async () => {
  const storage = memStorage();
  const api = createLocalApi(storage);
  const { id, writeKey } = await api.createSession('Équipe 1', circuit);
  let down = true;
  const flaky = { ...api, pushPoints: (...a) => (down ? Promise.reject(new Error('réseau')) : api.pushPoints(...a)) };
  const up = new Uplink(flaky, id, writeKey, () => {}, storage);
  const pts = course();
  pts.slice(0, 50).forEach((p) => up.enqueue(p));
  await up.flush();
  assert.equal(up.queue.length, 50, 'rien n\'est retiré si l\'envoi échoue');
  assert.equal(up.error, 'réseau');
  // Le téléphone redémarre : la file est relue depuis son stockage
  const up2 = new Uplink(flaky, id, writeKey, () => {}, storage);
  assert.equal(up2.queue.length, 50);
  pts.slice(50).forEach((p) => up2.enqueue(p));
  down = false;
  while (up2.queue.length) await up2.flush();
  assert.equal((await api.getPoints(id, -1, 5000)).length, pts.length);
});

test('mauvaise clé refusée', async () => {
  const api = createLocalApi(memStorage());
  const { id } = await api.createSession('x', circuit);
  await assert.rejects(api.pushPoints(id, 'fausse-cle', [[1, 0, 0, 0, 0, 0]]), /invalide/);
});

test('reprise sur un autre PC : tout l\'historique est reconstruit', async () => {
  const api = createLocalApi(memStorage());
  const { id, writeKey } = await api.createSession('Équipe 7', circuit);
  const pts = course();
  await api.pushPoints(id, writeKey, pts.map((p) => [p.t, p.lat, p.lon, p.speed, p.heading, p.acc]));

  const ref = new RaceTracker(circuit);
  ref.replay(pts.map((p) => toGpsPoint([p.t, p.lat, p.lon, p.speed, p.heading, p.acc])));

  const tracker = new RaceTracker(null);
  let session;
  const live = new LiveSource(api, { sid: id }, tracker, {
    onSession: (s) => { session = s; tracker.setCircuit(s.circuit); },
  });
  await live.start();
  live.stop();
  assert.equal(session.name, 'Équipe 7');
  const s = tracker.getSnapshot();
  assert.equal(live.points.length, pts.length);
  assert.deepEqual(s.laps.map((l) => l.time), ref.getSnapshot().laps.map((l) => l.time));
  assert.equal(s.pitStops.length, 1);
});

test('client Supabase : appels RPC et erreurs', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith('/push_points')) return { ok: false, status: 400, text: async () => '{"message":"Clé de course invalide"}' };
    return { ok: true, status: 200, text: async () => '{"id":"abc","write_key":"def"}' };
  };
  const api = createSupabaseApi('https://x.supabase.co', 'sb_publishable_123', fakeFetch);
  assert.deepEqual(await api.createSession('n', circuit), { id: 'abc', writeKey: 'def' });
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/create_session');
  assert.equal(calls[0].opts.headers.apikey, 'sb_publishable_123');
  assert.equal(calls[0].opts.headers.Authorization, undefined);
  await assert.rejects(api.pushPoints('a', 'b', []), /invalide/);
});

test('lecture des liens de course', () => {
  assert.deepEqual(parseSessionLink('https://x.onrender.com/#s=AAA&k=BBB&mode=emetteur'), { sid: 'AAA', key: 'BBB', mode: 'emetteur' });
  assert.deepEqual(parseSessionLink('https://x.onrender.com/#s=AAA'), { sid: 'AAA', key: null, mode: null });
  assert.equal(parseSessionLink('https://x.onrender.com/'), null);
});
