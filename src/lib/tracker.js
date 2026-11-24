// Moteur de suivi : reçoit les points GPS un par un et calcule
// tours, secteurs, état (piste / stands / arrêt) et alertes.
// Aucune dépendance à React ni à la carte : réutilisable côté stand, simulateur ou serveur.

import { distance, localProjection, pointInPolygon, segmentIntersection } from './geo.js';

export const DEFAULT_SETTINGS = {
  stopSpeedKmh: 3, // seuil de vitesse « arrêt »
  stopDelayS: 10, // durée sous le seuil avant alerte
  signalTimeoutS: 6, // plus de point reçu depuis X s => alerte perte de signal
  gateDebounceS: 5, // une même porte ne peut pas être refranchie avant X s
  maxGapS: 15, // au-delà, on n'interpole pas de franchissement entre deux points
  trailSeconds: 30, // longueur du fil d'Ariane
};

const PIT_MERGE_MS = 5000;

/**
 * @typedef {{lat:number, lon:number, t:number, speed?:number|null, heading?:number|null, acc?:number|null}} GpsPoint
 *   t en millisecondes (epoch ou temps simulé), speed en m/s.
 */

export class RaceTracker {
  constructor(circuit, settings = {}) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.listeners = new Set();
    this.setCircuit(circuit);
  }

  // ---------- configuration ----------

  setCircuit(circuit) {
    this.circuit = circuit;
    const ref = circuit?.track?.[0] || circuit?.center || [0, 0];
    this.proj = localProjection(ref);
    this.gates = [];
    if (circuit?.startFinish) {
      this.gates.push({ id: 'SF', kind: 'sf', ...this.#gateXY(circuit.startFinish) });
    }
    (circuit?.sectors || []).forEach((g, i) => {
      this.gates.push({ id: g.id, kind: 'sector', index: i, ...this.#gateXY(g) });
    });
    this.reset();
  }

  #gateXY(g) {
    return { A: this.proj.toXY(g.a), B: this.proj.toXY(g.b) };
  }

  reset() {
    this.lastPoint = null;
    this.lastReceivedWall = null;
    this.timeScale = 1;
    this.trail = [];
    this.speeds = [];
    this.speedKmh = 0;
    this.inPit = false;
    this.laps = [];
    this.currentLap = null;
    this.gateLastCross = {};
    this.stopSince = null;
    this.rawBelow = null;
    this.alerts = {}; // { stop?: Alert, signal?: Alert }
    this.incidents = [];
    this.pitStops = []; // arrêts terminés : { number, in, out, duration, lap }
    this.currentPit = null; // arrêt en cours : { number, in, lap }
    this.#emit();
  }

  /** Modifie les seuils d'alerte sans remettre la session à zéro. */
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.#emit();
  }

  /** Facteur d'accélération du temps (simulateur). 1 en conditions réelles. */
  setTimeScale(k) {
    this.timeScale = k;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #silent = false;

  #emit() {
    if (this.#silent) return;
    this.snapshot = this.#buildSnapshot();
    this.listeners.forEach((fn) => fn(this.snapshot));
  }

  // ---------- traitement des points ----------

  /** @param {GpsPoint} p  @param {number} [wallNow] */
  push(p, wallNow = Date.now()) {
    const prev = this.lastPoint;
    if (prev && p.t <= prev.t) return; // point en retard / doublon
    const pos = [p.lat, p.lon];

    // Vitesse : on privilégie celle du GPS, sinon on la déduit du déplacement.
    let v = p.speed != null && p.speed >= 0 ? p.speed * 3.6 : null;
    if (v == null && prev) {
      const dt = (p.t - prev.t) / 1000;
      v = dt > 0 ? (distance([prev.lat, prev.lon], pos) / dt) * 3.6 : 0;
    }
    this.speeds.push(v ?? 0);
    if (this.speeds.length > 3) this.speeds.shift();
    this.speedKmh = median(this.speeds); // filtre médian : supprime les pics de dérive GPS
    // Instant du premier échantillon brut sous le seuil : le filtre retarde la détection,
    // on date donc l'arrêt de ce premier échantillon.
    if ((v ?? 0) < this.settings.stopSpeedKmh) this.rawBelow ??= { t: p.t, pos };
    else this.rawBelow = null;

    const wasInPit = this.inPit;
    this.inPit = pointInPolygon(pos, this.circuit?.pit);
    if (this.inPit !== wasInPit) {
      // Instant estimé du passage de la limite : milieu entre les deux points (si rapprochés).
      const tEdge = prev && p.t - prev.t <= this.settings.maxGapS * 1000 ? (prev.t + p.t) / 2 : p.t;
      this.#onPitChange(tEdge);
    }

    // Perte de signal terminée ?
    if (this.alerts.signal) this.#resolveAlert('signal', p.t);

    // Franchissements de portes (avec interpolation temporelle)
    if (prev && p.t - prev.t <= this.settings.maxGapS * 1000) {
      this.#detectCrossings(prev, p);
    }

    if (this.currentLap && this.inPit) this.currentLap.pit = true;

    this.#detectStop(p, pos);

    this.trail.push({ pos, t: p.t });
    const minT = p.t - this.settings.trailSeconds * 1000;
    while (this.trail.length && this.trail[0].t < minT) this.trail.shift();

    this.lastPoint = { ...p, speedKmh: this.speedKmh };
    this.lastReceivedWall = wallNow;
    this.#emit();
  }

  /** Plusieurs points reçus d'un coup (rattrapage réseau) : une seule notification. */
  pushMany(points, wallNow = Date.now()) {
    this.#silent = true;
    try {
      for (const p of points) this.push(p, wallNow);
    } finally {
      this.#silent = false;
    }
    this.#emit();
  }

  /**
   * Reconstruit toute la session à partir de l'historique des points (reprise sur un autre PC,
   * circuit modifié…). Les pertes de signal passées sont détectées sur les trous entre points.
   */
  replay(points) {
    this.reset();
    this.#silent = true;
    try {
      for (const p of points) {
        this.tick(p.t); // trou dans l'historique => perte de signal
        this.push(p, p.t);
      }
    } finally {
      this.#silent = false;
    }
    // Dernier point récent : on le considère comme reçu maintenant (évite une fausse alerte
    // due à un léger décalage d'horloge entre le téléphone et ce PC).
    const last = this.lastPoint;
    if (last && Math.abs(Date.now() - last.t) < 60000) this.lastReceivedWall = Date.now();
    this.#emit();
  }

  /** À appeler régulièrement (horloge murale) pour détecter la perte de signal. */
  tick(wallNow = Date.now()) {
    if (!this.lastPoint || this.alerts.signal) return;
    const silentS = ((wallNow - this.lastReceivedWall) * this.timeScale) / 1000;
    if (silentS > this.settings.signalTimeoutS) {
      const t = this.clockNow(wallNow);
      this.alerts.signal = {
        type: 'signal',
        since: this.lastPoint.t,
        raisedAt: t,
        pos: [this.lastPoint.lat, this.lastPoint.lon],
        acknowledged: false,
      };
      this.#emit();
    }
  }

  #detectCrossings(prev, cur) {
    const P1 = this.proj.toXY([prev.lat, prev.lon]);
    const P2 = this.proj.toXY([cur.lat, cur.lon]);
    const hits = [];
    for (const g of this.gates) {
      const hit = segmentIntersection(P1, P2, g.A, g.B);
      if (!hit) continue;
      const t = prev.t + hit.t * (cur.t - prev.t);
      const last = this.gateLastCross[g.id];
      if (last != null && t - last < this.settings.gateDebounceS * 1000) continue;
      hits.push({ gate: g, t });
    }
    hits.sort((a, b) => a.t - b.t); // plusieurs portes franchies entre deux points
    for (const { gate, t } of hits) {
      this.gateLastCross[gate.id] = t;
      if (gate.kind === 'sf') this.#onStartFinish(t);
      else if (this.currentLap) this.currentLap.sectorCross[gate.index] ??= t;
    }
  }

  #onStartFinish(t) {
    const nSectors = this.gates.filter((g) => g.kind === 'sector').length;
    const lap = this.currentLap;
    if (lap) {
      const bounds = [lap.start, ...lap.sectorCross, t];
      const sectors = [];
      for (let i = 0; i <= nSectors; i++) {
        const a = bounds[i], b = bounds[i + 1];
        sectors.push(a != null && b != null && b > a ? b - a : null);
      }
      this.laps.push({
        number: lap.number,
        start: lap.start,
        end: t,
        time: t - lap.start,
        sectors,
        pit: lap.pit,
      });
    }
    this.currentLap = {
      number: (lap?.number ?? 0) + 1,
      start: t,
      sectorCross: new Array(nSectors).fill(null),
      pit: this.inPit,
    };
  }

  // Entrée / sortie de la zone des stands. Une ressortie suivie d'une rentrée
  // en moins de PIT_MERGE_MS (dérive GPS en bordure de zone) compte comme un seul arrêt.
  #onPitChange(t) {
    if (this.inPit) {
      const last = this.pitStops[this.pitStops.length - 1];
      if (last && t - last.out < PIT_MERGE_MS) {
        this.pitStops.pop();
        this.currentPit = { number: last.number, in: last.in, lap: last.lap };
      } else {
        this.currentPit = { number: this.pitStops.length + 1, in: t, lap: this.currentLap?.number ?? 0 };
      }
    } else if (this.currentPit) {
      this.pitStops.push({ ...this.currentPit, out: t, duration: t - this.currentPit.in });
      this.currentPit = null;
    }
  }

  #detectStop(p, pos) {
    const s = this.settings;
    if (this.speedKmh < s.stopSpeedKmh) {
      if (this.stopSince == null) this.stopSince = this.rawBelow ?? { t: p.t, pos };
      const stoppedS = (p.t - this.stopSince.t) / 1000;
      if (!this.inPit && !this.alerts.stop && stoppedS >= s.stopDelayS) {
        this.alerts.stop = {
          type: 'stop',
          since: this.stopSince.t,
          raisedAt: p.t,
          pos: this.stopSince.pos,
          acknowledged: false,
        };
      }
      // Arrivé aux stands pendant l'arrêt : l'alerte n'a plus lieu d'être
      if (this.inPit && this.alerts.stop) this.#resolveAlert('stop', p.t);
    } else {
      this.stopSince = null;
      if (this.alerts.stop) this.#resolveAlert('stop', p.t);
    }
  }

  #resolveAlert(type, t) {
    const a = this.alerts[type];
    if (!a) return;
    this.incidents.unshift({ ...a, end: t, duration: t - a.since });
    delete this.alerts[type];
  }

  /** Acquitte toutes les alertes actives (coupe le son, l'alerte reste visible). */
  acknowledge() {
    let changed = false;
    for (const a of Object.values(this.alerts)) {
      if (!a.acknowledged) { a.acknowledged = true; changed = true; }
    }
    if (changed) this.#emit();
  }

  // ---------- lecture ----------

  /** Heure « course » estimée maintenant (temps GPS + temps écoulé depuis réception). */
  clockNow(wallNow = Date.now()) {
    if (!this.lastPoint) return null;
    return this.lastPoint.t + (wallNow - this.lastReceivedWall) * this.timeScale;
  }

  #buildSnapshot() {
    const validLaps = this.laps.filter((l) => !l.pit);
    const bestLap = validLaps.reduce((b, l) => (!b || l.time < b.time ? l : b), null);
    const nSectors = (this.circuit?.sectors?.length ?? 0) + 1;
    const bestSectors = Array.from({ length: nSectors }, (_, i) => {
      const vals = this.laps.map((l) => l.sectors[i]).filter((v) => v != null);
      return vals.length ? Math.min(...vals) : null;
    });

    // Écart en direct : à chaque porte franchie, temps écoulé dans le tour
    // comparé au temps cumulé du meilleur tour à la même porte.
    let liveDelta = null;
    if (bestLap && this.currentLap) {
      let ref = 0;
      for (let i = 0; i < this.currentLap.sectorCross.length; i++) {
        const sec = bestLap.sectors[i];
        if (sec == null) break;
        ref += sec;
        const cross = this.currentLap.sectorCross[i];
        if (cross != null) liveDelta = { gate: i, delta: cross - this.currentLap.start - ref };
      }
    }

    const activeAlerts = Object.values(this.alerts);
    let status = 'waiting';
    if (this.lastPoint) {
      if (this.alerts.signal) status = 'signal';
      else if (this.alerts.stop) status = 'alert';
      else if (this.inPit) status = 'pit';
      else if (this.stopSince) status = 'stopped';
      else status = 'track';
    }

    return {
      status,
      lastPoint: this.lastPoint,
      speedKmh: this.speedKmh,
      inPit: this.inPit,
      trail: this.trail.map((x) => x.pos),
      laps: [...this.laps],
      lastLap: this.laps[this.laps.length - 1] ?? null,
      bestLap,
      bestSectors,
      liveDelta,
      settings: { ...this.settings },
      currentLap: this.currentLap
        ? { number: this.currentLap.number, start: this.currentLap.start, sectorCross: [...this.currentLap.sectorCross], pit: this.currentLap.pit }
        : null,
      alerts: activeAlerts.map((a) => ({ ...a })),
      needsSound: activeAlerts.some((a) => !a.acknowledged),
      incidents: [...this.incidents],
      stopSince: this.stopSince?.t ?? null,
      pitStops: this.pitStops.map((s) => ({ ...s })),
      currentPit: this.currentPit ? { ...this.currentPit } : null,
      pitTotal: this.pitStops.reduce((sum, s) => sum + s.duration, 0),
    };
  }

  getSnapshot() {
    return this.snapshot;
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
