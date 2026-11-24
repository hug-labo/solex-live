import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceTracker } from '../src/lib/tracker.js';
import { localProjection } from '../src/lib/geo.js';
import { makeDemoCircuit } from '../src/lib/demoCircuit.js';

const O = [46.8, 2.4];
const proj = localProjection(O);
const ll = (x, y) => proj.toLatLon({ x, y });

// Piste fictive : ligne droite le long de l'axe x, porte d'arrivée verticale en x=0,
// secteur en x=100, stands entre x=500 et x=600.
const circuit = {
  name: 'test',
  track: [ll(-10, 0), ll(1000, 0)],
  startFinish: { a: ll(0, -10), b: ll(0, 10) },
  sectors: [{ id: 'S1', name: 'S1', a: ll(100, -10), b: ll(100, 10) }],
  pit: [ll(500, -20), ll(600, -20), ll(600, 20), ll(500, 20)],
};

const pt = (x, tS, speed = null) => {
  const [lat, lon] = ll(x, 0);
  return { lat, lon, t: tS * 1000, speed };
};

test('interpolation du franchissement de ligne', () => {
  const tr = new RaceTracker(circuit);
  tr.push(pt(-5, 0, 10));
  tr.push(pt(15, 1, 10)); // ligne à x=0 => franchie à t = 0.25 s
  const lap = tr.getSnapshot().currentLap;
  assert.equal(lap.number, 1);
  assert.ok(Math.abs(lap.start - 250) < 2, `départ ${lap.start}`);
});

test('tour bouclé et secteurs calculés', () => {
  const tr = new RaceTracker(circuit, { gateDebounceS: 0 });
  tr.push(pt(-5, 0, 10));
  tr.push(pt(5, 1, 10)); // SF à t=0.5
  tr.push(pt(95, 10, 10));
  tr.push(pt(105, 11, 10)); // S1 à t=10.5
  tr.push(pt(-5, 20, 10)); // retour : on refranchit S1 (déjà noté) puis SF
  const s = tr.getSnapshot();
  assert.equal(s.laps.length, 1);
  const lap = s.laps[0];
  assert.equal(lap.sectors.length, 2);
  assert.ok(Math.abs(lap.sectors[0] - 10000) < 5, `S1 ${lap.sectors[0]}`);
  assert.ok(Math.abs(lap.sectors[0] + lap.sectors[1] - lap.time) < 1);
});

test('alerte arrêt après 10 s sous 3 km/h, hors stands', () => {
  const tr = new RaceTracker(circuit);
  tr.push(pt(200, 0, 15));
  for (let i = 1; i <= 9; i++) tr.push(pt(200, i, 0.2));
  assert.equal(tr.getSnapshot().alerts.length, 0, 'pas encore 10 s');
  tr.push(pt(200, 11, 0.2));
  const s = tr.getSnapshot();
  assert.equal(s.alerts[0]?.type, 'stop');
  assert.equal(s.needsSound, true);
  tr.acknowledge();
  assert.equal(tr.getSnapshot().needsSound, false);
  tr.push(pt(210, 12, 10));
  tr.push(pt(220, 13, 10));
  assert.equal(tr.getSnapshot().alerts.length, 0, 'alerte levée en repartant');
  assert.equal(tr.getSnapshot().incidents.length, 1);
});

test("pas d'alerte d'arrêt dans la zone des stands", () => {
  const tr = new RaceTracker(circuit);
  tr.push(pt(550, 0, 5));
  for (let i = 1; i <= 30; i++) tr.push(pt(550, i, 0));
  const s = tr.getSnapshot();
  assert.equal(s.alerts.length, 0);
  assert.equal(s.status, 'pit');
});

test('alerte perte de signal', () => {
  const tr = new RaceTracker(circuit);
  tr.push(pt(200, 0, 15), 1000);
  tr.tick(5000);
  assert.equal(tr.getSnapshot().alerts.length, 0);
  tr.tick(8000);
  assert.equal(tr.getSnapshot().alerts[0]?.type, 'signal');
  tr.push(pt(215, 8, 15), 9000);
  assert.equal(tr.getSnapshot().alerts.length, 0);
});

test('écart en direct au passage des portes', () => {
  const tr = new RaceTracker(circuit, { gateDebounceS: 5 });
  // tour 1 : S1 en 10 s
  tr.push(pt(-5, 0, 10)); tr.push(pt(5, 1, 10)); // SF t=0.5
  tr.push(pt(95, 10, 10)); tr.push(pt(105, 11, 10)); // S1 t=10.5
  tr.push(pt(-5, 20, 10)); // SF ~19.5
  // tour 2 : S1 plus lent de 2 s
  tr.push(pt(95, 31, 10)); tr.push(pt(105, 32, 10));
  const d = tr.getSnapshot().liveDelta;
  assert.equal(d.gate, 0);
  assert.ok(d.delta > 1 && d.delta < 3000, `delta ${d.delta}`);
});

test('réglages modifiables sans remise à zéro', () => {
  const tr = new RaceTracker(circuit);
  tr.push(pt(200, 0, 15));
  tr.updateSettings({ stopDelayS: 3 });
  for (let i = 1; i <= 4; i++) tr.push(pt(200, i, 0.1));
  assert.equal(tr.getSnapshot().alerts[0]?.type, 'stop');
});

test('le circuit de démo est cohérent', () => {
  const c = makeDemoCircuit();
  assert.ok(c.track.length > 50);
  assert.equal(c.sectors.length, 2);
  assert.equal(c.pit.length, 4);
});
