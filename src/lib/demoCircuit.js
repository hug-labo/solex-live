// Circuit de démonstration généré (forme d'ovale arrondi avec une chicane),
// pour pouvoir tout tester sans avoir dessiné de tracé.

import { localProjection } from './geo.js';

export function makeDemoCircuit(center = [46.8016, 2.4005]) {
  const proj = localProjection(center);
  const A = 380, B = 160; // demi-axes (m)
  const N = 96;
  const track = [];
  for (let i = 0; i < N; i++) {
    const th = -Math.PI / 2 + (i / N) * 2 * Math.PI; // départ en bas, sens anti-horaire
    const c = Math.cos(th), s = Math.sin(th);
    let r = 1 / Math.pow(Math.pow(Math.abs(c) / A, 4) + Math.pow(Math.abs(s) / B, 4), 1 / 4);
    const dTop = Math.atan2(Math.sin(th - Math.PI / 2), Math.cos(th - Math.PI / 2));
    r *= 1 - 0.3 * Math.exp(-((dTop / 0.3) ** 2)); // chicane en haut
    track.push(proj.toLatLon({ x: r * c, y: r * s }));
  }
  const ll = (x, y) => proj.toLatLon({ x, y });
  return {
    id: 'demo',
    name: 'Circuit de démonstration',
    center,
    zoom: 16,
    track,
    startFinish: { a: ll(40, -182), b: ll(40, -138) },
    sectors: [
      { id: 'S1', name: 'S1', a: ll(358, 0), b: ll(402, 0) },
      { id: 'S2', name: 'S2', a: ll(-402, 0), b: ll(-358, 0) },
    ],
    pit: [ll(-200, -130), ll(-60, -130), ll(-60, -100), ll(-200, -100)],
    updatedAt: Date.now(),
  };
}

export function emptyCircuit(center, zoom = 16) {
  return {
    id: 'c' + Date.now().toString(36),
    name: 'Nouveau circuit',
    center,
    zoom,
    track: [],
    startFinish: null,
    sectors: [],
    pit: [],
    updatedAt: Date.now(),
  };
}
