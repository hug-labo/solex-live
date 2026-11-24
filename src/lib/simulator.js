// Simulateur : un Solex virtuel qui roule sur le tracé et émet des points GPS à 1 Hz,
// exactement comme le ferait le téléphone embarqué.

import { cumulativeLengths, nearestDistanceOnTrack, pointAtDistance, bearing, angleDiff, localProjection } from './geo.js';

const STEP = 5; // pas du profil de vitesse (m)
const ACCEL = 1.8; // m/s² (un Solex n'est pas une fusée)
const DECEL = 4.5; // m/s²
const PIT_SPEED = 25 / 3.6; // limitation de vitesse dans la voie des stands

export class Simulator {
  /**
   * @param {object} circuit
   * @param {(p:import('./tracker.js').GpsPoint)=>void} onPoint
   * @param {(state:object)=>void} [onState]
   */
  constructor(circuit, onPoint, onState = () => {}) {
    this.onPoint = onPoint;
    this.onState = null; // branché après l'initialisation (pas de notification pendant le constructeur)
    this.speedSetKmh = 70;
    this.timeScale = 1;
    this.pitStopS = 20;
    this.gpsNoiseM = 1.2;
    this.timer = null;
    this.setCircuit(circuit);
    this.onState = onState;
  }

  setCircuit(circuit) {
    clearInterval(this.timer);
    this.timer = null;
    this.circuit = circuit;
    this.track = circuit?.track ?? [];
    this.cum = cumulativeLengths(this.track, true);
    this.length = this.cum[this.cum.length - 1] || 0;
    this.#buildProfile();
    this.resetState();
  }

  get usable() {
    return this.track.length >= 3 && this.length > 50;
  }

  get hasPit() {
    return (this.circuit?.pit?.length ?? 0) >= 3;
  }

  resetState() {
    // Départ 30 m avant le début du tracé pour franchir la ligne rapidement si elle y est.
    this.s = this.usable ? this.length - 30 : 0;
    this.v = 0;
    this.t = Date.now();
    this.nextEmit = this.t;
    this.mode = 'run'; // run | broken | pitIn | pitStop | pitOut
    this.signalLost = false;
    this.pitRequested = false;
    this.detour = null;
    this.emitted = 0;
    this.#notify();
  }

  // Profil de vitesse le long du tracé : plus lent dans les virages,
  // avec freinage / accélération physiquement limités.
  #buildProfile() {
    if (!this.usable) { this.profile = []; return; }
    const n = Math.ceil(this.length / STEP);
    const vmax = this.speedSetKmh / 3.6;
    const prof = new Array(n);
    const W = 20; // fenêtre de mesure de courbure (m)
    for (let i = 0; i < n; i++) {
      const s = i * STEP;
      const a = pointAtDistance(this.track, this.cum, s - W).pos;
      const b = pointAtDistance(this.track, this.cum, s).pos;
      const c = pointAtDistance(this.track, this.cum, s + W).pos;
      const turn = Math.abs(angleDiff(bearing(a, b), bearing(b, c))); // degrés sur 2W mètres
      const radius = turn > 0.5 ? (W * 180) / (Math.PI * turn) : Infinity;
      const vCorner = Math.sqrt(4.5 * radius); // accélération latérale max ≈ 4.5 m/s²
      prof[i] = Math.min(vmax, vCorner);
    }
    // Deux tours de passes pour gérer le bouclage du circuit
    for (let k = 0; k < 2; k++) {
      for (let i = 2 * n - 1; i >= 0; i--) {
        const j = i % n, nx = (i + 1) % n;
        prof[j] = Math.min(prof[j], Math.sqrt(prof[nx] ** 2 + 2 * DECEL * STEP));
      }
      for (let i = 0; i < 2 * n; i++) {
        const j = i % n, pv = (i - 1 + n) % n;
        prof[j] = Math.min(prof[j], Math.sqrt(prof[pv] ** 2 + 2 * ACCEL * STEP));
      }
    }
    this.profile = prof;
  }

  #profileAt(s) {
    if (!this.profile.length) return 0;
    const n = this.profile.length;
    const x = (((s % this.length) + this.length) % this.length) / STEP;
    const i = Math.floor(x) % n;
    const f = x - Math.floor(x);
    return this.profile[i] * (1 - f) + this.profile[(i + 1) % n] * f;
  }

  // ---------- commandes ----------

  setSpeed(kmh) {
    this.speedSetKmh = kmh;
    this.#buildProfile();
    this.#notify();
  }

  setTimeScale(k) {
    this.timeScale = k;
    this.#notify();
  }

  start() {
    if (this.timer || !this.usable) return;
    this.lastWall = performance.now();
    this.timer = setInterval(() => this.#loop(), 50);
    this.#notify();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.#notify();
  }

  get running() {
    return this.timer != null;
  }

  breakdown() {
    if (this.mode === 'run') this.mode = 'broken';
    this.#notify();
  }

  restart() {
    if (this.mode === 'broken') this.mode = 'run';
    if (this.mode === 'pitStop') this.pitRemaining = 0;
    this.#notify();
  }

  requestPit() {
    if (!this.hasPit || this.mode !== 'run') return;
    this.pitRequested = true;
    const centroid = polygonCentroid(this.circuit.pit);
    this.pitCentroid = centroid;
    const sNear = nearestDistanceOnTrack(this.track, this.cum, centroid);
    this.pitEntryS = sNear - 50;
    this.#notify();
  }

  setSignalLost(lost) {
    this.signalLost = lost;
    this.#notify();
  }

  // ---------- boucle ----------

  #loop() {
    const now = performance.now();
    const wallDt = Math.min(0.5, (now - this.lastWall) / 1000);
    this.lastWall = now;
    let simDt = wallDt * this.timeScale;
    // sous-pas de 0,1 s pour une intégration stable
    while (simDt > 1e-6) {
      const dt = Math.min(0.1, simDt);
      this.#step(dt);
      simDt -= dt;
      this.t += dt * 1000;
      if (this.t >= this.nextEmit) {
        this.nextEmit += 1000; // 1 Hz
        if (!this.signalLost) this.#emit();
      }
    }
  }

  #step(dt) {
    const approach = (target) => {
      if (this.v < target) this.v = Math.min(target, this.v + ACCEL * dt);
      else this.v = Math.max(target, this.v - DECEL * dt);
    };

    switch (this.mode) {
      case 'broken':
        this.v = Math.max(0, this.v - DECEL * dt);
        if (this.detour) this.#advanceDetour(dt); else this.s += this.v * dt;
        return;

      case 'run': {
        // Entrée aux stands demandée et point d'entrée atteint ?
        if (this.pitRequested && this.#passed(this.pitEntryS, this.v * dt)) {
          this.pitRequested = false;
          this.#startDetour();
          return;
        }
        const target = this.#profileAt(this.s) * (0.97 + Math.random() * 0.06);
        approach(target);
        this.s += this.v * dt;
        return;
      }

      case 'pitIn': {
        const remaining = this.detour.split - this.detour.d;
        approach(Math.min(PIT_SPEED, Math.sqrt(2 * 2.5 * Math.max(0, remaining))));
        this.#advanceDetour(dt);
        if (remaining < 0.5 || (this.v < 0.05 && remaining < 3)) {
          this.v = 0;
          this.mode = 'pitStop';
          this.pitRemaining = this.pitStopS;
          this.#notify();
        }
        return;
      }

      case 'pitStop':
        this.v = 0;
        this.pitRemaining -= dt;
        if (this.pitRemaining <= 0) { this.mode = 'pitOut'; this.#notify(); }
        return;

      case 'pitOut':
        approach(PIT_SPEED);
        this.#advanceDetour(dt);
        if (this.detour.d >= this.detour.len) {
          this.s = this.detour.exitS;
          this.detour = null;
          this.mode = 'run';
          this.#notify();
        }
        return;
    }
  }

  #passed(sMark, ds) {
    const L = this.length;
    const a = ((this.s % L) + L) % L;
    const m = ((sMark % L) + L) % L;
    const b = a + ds;
    return (a <= m && m < b) || (a <= m + L && m + L < b);
  }

  #startDetour() {
    const entry = pointAtDistance(this.track, this.cum, this.s).pos;
    const exitS = this.s + 120;
    const exit = pointAtDistance(this.track, this.cum, exitS).pos;
    const pts = [entry, this.pitCentroid, exit];
    const cum = cumulativeLengths(pts, false);
    this.detour = { pts, cum, d: 0, len: cum[cum.length - 1], split: cum[1], exitS };
    this.mode = 'pitIn';
    this.#notify();
  }

  #advanceDetour(dt) {
    if (!this.detour) return;
    this.detour.d = Math.min(this.detour.len, this.detour.d + this.v * dt);
  }

  #currentPose() {
    if (this.detour) {
      const { pts, cum, d } = this.detour;
      const i = d < cum[1] ? 0 : 1;
      const f = (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]);
      const a = pts[i], b = pts[i + 1];
      return { pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
    }
    return pointAtDistance(this.track, this.cum, this.s);
  }

  #emit() {
    const { pos, heading } = this.#currentPose();
    const proj = localProjection(pos);
    const noisy = proj.toLatLon({ x: gauss() * this.gpsNoiseM, y: gauss() * this.gpsNoiseM });
    const speed = Math.max(0, this.v + gauss() * 0.15);
    this.emitted++;
    this.onPoint({ lat: noisy[0], lon: noisy[1], t: Math.round(this.t), speed, heading, acc: this.gpsNoiseM * 2 });
  }

  #notify() {
    this.onState?.({
      running: this.running,
      mode: this.mode,
      speedSetKmh: this.speedSetKmh,
      timeScale: this.timeScale,
      signalLost: this.signalLost,
      pitRequested: this.pitRequested,
      usable: this.usable,
      hasPit: this.hasPit,
      lengthM: this.length,
    });
  }
}

function gauss() {
  // Box-Muller
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function polygonCentroid(poly) {
  let lat = 0, lon = 0;
  poly.forEach((p) => { lat += p[0]; lon += p[1]; });
  return [lat / poly.length, lon / poly.length];
}
