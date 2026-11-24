// Envoi des points du téléphone vers le serveur.
// Les points sont d'abord mis en file d'attente (gardée dans le téléphone),
// puis envoyés par paquets chaque seconde. Coupure réseau : la file grossit
// et se vide automatiquement au retour du réseau. Rien n'est perdu.

const BATCH = 300;
const MAX_QUEUE = 200000; // ~55 h à 1 Hz

const r = (x, d) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export class Uplink {
  constructor(api, sid, key, onStatus = () => {}, storage = globalThis.localStorage) {
    this.api = api;
    this.sid = sid;
    this.key = key;
    this.onStatus = onStatus;
    this.storage = storage;
    this.qKey = 'solex.tx.queue.' + sid;
    this.queue = this.#load();
    this.sent = 0;
    this.lastOk = null;
    this.error = null;
    this.busy = false;
    this.timer = null;
    this.lastT = this.queue.length ? this.queue[this.queue.length - 1][0] : -1;
  }

  #load() {
    try { return JSON.parse(this.storage.getItem(this.qKey)) || []; } catch { return []; }
  }

  #save() {
    try { this.storage.setItem(this.qKey, JSON.stringify(this.queue)); } catch { /* stockage plein : on garde en mémoire */ }
  }

  #notify() {
    this.onStatus({ pending: this.queue.length, sent: this.sent, lastOk: this.lastOk, error: this.error });
  }

  /** @param {import('./tracker.js').GpsPoint} p */
  enqueue(p) {
    const t = Math.round(p.t);
    if (t <= this.lastT) return false;
    this.lastT = t;
    this.queue.push([t, r(p.lat, 7), r(p.lon, 7), r(p.speed, 2), r(p.heading, 1), r(p.acc, 1)]);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    this.#save();
    this.#notify();
    return true;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), 1000);
    this.flush();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async flush() {
    if (this.busy || !this.queue.length) return;
    this.busy = true;
    const batch = this.queue.slice(0, BATCH);
    try {
      await this.api.pushPoints(this.sid, this.key, batch);
      this.queue.splice(0, batch.length);
      this.sent += batch.length;
      this.lastOk = Date.now();
      this.error = null;
      this.#save();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.busy = false;
      this.#notify();
    }
  }
}
