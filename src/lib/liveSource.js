// Source « course en ligne » pour un PC stand / spectateur :
//  1. charge la course (nom + circuit) ;
//  2. télécharge tout l'historique des points et le rejoue dans le moteur ;
//  3. interroge ensuite le serveur chaque seconde pour les nouveaux points,
//     et toutes les 10 s pour un éventuel changement de circuit.

import { toGpsPoint } from './api.js';

const POLL_MS = 1000;
const PAGE = 5000;

export class LiveSource {
  /**
   * @param {ReturnType<import('./api.js').getApi>} api
   * @param {{sid:string, key?:string|null}} session
   * @param {import('./tracker.js').RaceTracker} tracker
   * @param {{onStatus?:(s:object)=>void, onSession?:(s:{name:string, circuit:object})=>void}} cb
   */
  constructor(api, session, tracker, { onStatus = () => {}, onSession = () => {} } = {}) {
    this.api = api;
    this.sid = session.sid;
    this.key = session.key ?? null;
    this.tracker = tracker;
    this.onStatus = onStatus;
    this.onSession = onSession;
    this.points = []; // historique complet (format serveur)
    this.lastT = -1;
    this.circuitStamp = undefined;
    this.timer = null;
    this.stopped = false;
    this.polls = 0;
    this.status = { phase: 'loading', count: 0, lastOk: null, lastPointWall: null, error: null, name: '' };
  }

  #setStatus(patch) {
    this.status = { ...this.status, ...patch, count: this.points.length };
    this.onStatus(this.status);
  }

  async start() {
    await this.#load();
    this.#schedule();
  }

  async #load() {
    this.#setStatus({ phase: 'loading' });
    try {
      const s = await this.api.getSession(this.sid);
      if (!s) throw new Error('Course introuvable : lien incorrect ou course supprimée.');
      if (this.stopped) return;
      this.circuitStamp = s.circuit?.updatedAt;
      this.#setStatus({ name: s.name });
      this.onSession(s);
      await this.#fetchNew();
      if (this.stopped) return;
      this.replay();
      this.#setStatus({ phase: 'live', lastOk: Date.now(), error: null });
    } catch (e) {
      this.#setStatus({ phase: 'error', error: e.message });
    }
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Rejoue tout l'historique connu (au chargement ou après un changement de circuit). */
  replay() {
    this.tracker.setTimeScale(1);
    this.tracker.replay(this.points.map(toGpsPoint));
  }

  /** Le circuit a été modifié sur ce PC : on l'envoie au serveur (si on a la clé). */
  async publishCircuit(circuit) {
    if (!this.key) return;
    this.circuitStamp = circuit.updatedAt;
    await this.api.updateCircuit(this.sid, this.key, circuit);
  }

  #schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.#poll().finally(() => this.#schedule()), POLL_MS);
  }

  // Récupère tous les points postérieurs au dernier connu (par pages). Renvoie les nouveaux.
  async #fetchNew() {
    const fresh = [];
    for (;;) {
      const page = await this.api.getPoints(this.sid, this.lastT, PAGE);
      if (!page.length) break;
      fresh.push(...page);
      this.points.push(...page);
      this.lastT = page[page.length - 1][0];
      this.#setStatus({ phase: this.status.phase });
      if (page.length < PAGE) break;
    }
    if (fresh.length) this.status.lastPointWall = Date.now();
    return fresh;
  }

  async #poll() {
    try {
      // Premier chargement raté (réseau) : on recommence depuis le début.
      if (this.status.phase === 'error' && this.circuitStamp === undefined) {
        await this.#load();
        return;
      }
      const fresh = await this.#fetchNew();
      if (fresh.length) this.tracker.pushMany(fresh.map(toGpsPoint));

      if (++this.polls % 10 === 0) {
        const s = await this.api.getSession(this.sid);
        if (s && s.circuit?.updatedAt !== this.circuitStamp) {
          this.circuitStamp = s.circuit?.updatedAt;
          this.onSession(s); // l'application applique le circuit puis appelle replay()
        }
      }
      this.#setStatus({ phase: 'live', lastOk: Date.now(), error: null });
    } catch (e) {
      this.#setStatus({ phase: this.status.phase === 'loading' ? 'error' : 'offline', error: e.message });
    }
  }
}
