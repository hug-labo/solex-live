import { useEffect, useMemo, useRef, useState } from 'react';
import { getApi } from '../lib/api.js';
import { Uplink } from '../lib/uplink.js';
import { Simulator } from '../lib/simulator.js';

const MIN_INTERVAL_MS = 900; // ~1 point par seconde
const MAX_ACC_M = 50; // points trop imprécis ignorés

// Page « émetteur » du téléphone embarqué sur le Solex.
export default function Transmitter({ sid, writeKey }) {
  const api = getApi();
  const [session, setSession] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [source, setSource] = useState(null); // null | 'gps' | 'sim'
  const [gps, setGps] = useState(null); // dernier point reçu du GPS
  const [gpsError, setGpsError] = useState(null);
  const [net, setNet] = useState({ pending: 0, sent: 0, lastOk: null, error: null });
  const [wake, setWake] = useState('off');
  const [hidden, setHidden] = useState(document.hidden);
  const [simMode, setSimMode] = useState('run');
  const [, force] = useState(0);

  const uplink = useMemo(() => new Uplink(api, sid, writeKey, setNet), [api, sid, writeKey]);
  const watchRef = useRef(null);
  const simRef = useRef(null);
  const wakeRef = useRef(null);
  const lastAccepted = useRef(0);

  useEffect(() => {
    document.title = 'Solex Live — Émetteur';
    api.getSession(sid)
      .then((s) => (s ? setSession(s) : setLoadError('Course introuvable : vérifiez le lien ou le QR code.')))
      .catch((e) => setLoadError(e.message));
    uplink.start(); // vide une éventuelle file restée d'une session précédente
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => { clearInterval(id); uplink.stop(); };
  }, [api, sid, uplink]);

  // Wake Lock : l'écran ne doit pas s'éteindre (sinon le GPS s'arrête sur la plupart des téléphones).
  const requestWake = async () => {
    if (!('wakeLock' in navigator)) { setWake('unsupported'); return; }
    try {
      wakeRef.current = await navigator.wakeLock.request('screen');
      setWake('on');
      wakeRef.current.addEventListener('release', () => setWake('off'));
    } catch {
      setWake('denied');
    }
  };

  useEffect(() => {
    const onVis = () => {
      setHidden(document.hidden);
      if (!document.hidden && source) requestWake();
    };
    const onUnload = (e) => { if (source) { e.preventDefault(); e.returnValue = ''; } };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [source]);

  const accept = (p) => {
    if (p.t - lastAccepted.current < MIN_INTERVAL_MS) return;
    if (p.acc != null && p.acc > MAX_ACC_M) { setGps({ ...p, rejected: true }); return; }
    lastAccepted.current = p.t;
    setGps(p);
    uplink.enqueue(p);
  };

  const startGps = () => {
    if (!navigator.geolocation) { setGpsError('GPS indisponible sur cet appareil.'); return; }
    setGpsError(null);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        accept({
          t: pos.timestamp || Date.now(),
          lat: c.latitude,
          lon: c.longitude,
          speed: c.speed != null && Number.isFinite(c.speed) ? c.speed : null,
          heading: c.heading != null && Number.isFinite(c.heading) ? c.heading : null,
          acc: c.accuracy,
        });
        setGpsError(null);
      },
      (err) => setGpsError(err.code === 1
        ? 'Accès à la position refusé. Autorisez la localisation pour ce site dans les réglages du navigateur.'
        : 'Signal GPS indisponible pour le moment…'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
    setSource('gps');
    requestWake();
  };

  const startSim = () => {
    const sim = new Simulator(session.circuit, accept, (st) => setSimMode(st.mode));
    if (!sim.usable) { setGpsError('Le circuit de cette course n\'a pas de tracé : simulation impossible.'); return; }
    sim.start();
    simRef.current = sim;
    setSource('sim');
    requestWake();
  };

  const stop = () => {
    if (!confirm('Arrêter l\'émission ? Le stand verra une perte de signal.')) return;
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null;
    simRef.current?.stop();
    simRef.current = null;
    wakeRef.current?.release?.().catch(() => {});
    setSource(null);
  };

  if (loadError) {
    return <div className="tx"><h1>Émetteur Solex</h1><p className="tx-err">{loadError}</p></div>;
  }
  if (!session) {
    return <div className="tx"><h1>Émetteur Solex</h1><p>Chargement de la course…</p></div>;
  }

  const now = Date.now();
  const age = (t) => (t ? Math.round((now - t) / 1000) : null);
  const gpsAge = gps ? age(gps.t) : null;
  const netOk = net.lastOk && age(net.lastOk) < 10 && !net.error;
  const sim = simRef.current;

  return (
    <div className="tx">
      <h1>Émetteur Solex</h1>
      <p className="tx-course">{session.name || 'Course sans nom'} · {session.circuit?.name}</p>
      {api.kind === 'local' && (
        <p className="tx-warn">Mode test local : ce téléphone ne peut pas joindre le stand. Configurez le serveur (voir README).</p>
      )}

      {!source ? (
        <>
          <button className="tx-big go" onClick={startGps}>▶ DÉMARRER L'ÉMISSION</button>
          <button className="tx-small" onClick={startSim}>Tester sans rouler (Solex simulé)</button>
          <ul className="tx-tips">
            <li>Téléphone <b>branché</b> sur une batterie.</li>
            <li>Laissez cette page <b>ouverte et au premier plan</b>, écran allumé.</li>
            <li>Autorisez la localisation « précise ».</li>
          </ul>
        </>
      ) : (
        <>
          <div className={`tx-state ${netOk ? 'ok' : 'bad'}`}>
            {source === 'sim' ? 'SIMULATION EN COURS' : 'ÉMISSION EN COURS'}
          </div>
          {hidden && <p className="tx-err">Page masquée : l'émission risque de s'arrêter. Revenez sur cette page.</p>}
          <dl className="tx-grid">
            <dt>GPS</dt>
            <dd>
              {gpsError ? <span className="tx-errtxt">{gpsError}</span>
                : gps ? (
                  <>
                    {gps.rejected ? 'imprécis' : 'OK'} · ±{Math.round(gps.acc ?? 0)} m
                    {gps.speed != null && <> · {Math.round(gps.speed * 3.6)} km/h</>}
                    {gpsAge > 3 && <> · il y a {gpsAge} s</>}
                  </>
                ) : 'recherche du signal…'}
            </dd>
            <dt>Réseau</dt>
            <dd>
              {net.error ? <span className="tx-errtxt">{net.error}</span> : netOk ? 'OK' : 'en attente…'}
              {net.lastOk && <> · dernier envoi il y a {age(net.lastOk)} s</>}
            </dd>
            <dt>En attente</dt>
            <dd>{net.pending} point(s){net.pending > 5 && ' (envoi dès le retour du réseau)'}</dd>
            <dt>Envoyés</dt>
            <dd>{net.sent}</dd>
            <dt>Écran</dt>
            <dd>
              {wake === 'on' ? 'maintenu allumé'
                : wake === 'unsupported' ? 'à régler à la main (mise en veille : jamais)'
                  : 'peut s\'éteindre — touchez l\'écran'}
            </dd>
          </dl>
          {source === 'sim' && sim && (
            <div className="tx-row">
              {simMode === 'broken'
                ? <button className="tx-small" onClick={() => sim.restart()}>Repartir</button>
                : <button className="tx-small" onClick={() => sim.breakdown()}>Simuler une panne</button>}
              <button className="tx-small" onClick={() => sim.requestPit()} disabled={!sim.hasPit || simMode !== 'run'}>Aller aux stands</button>
            </div>
          )}
          <button className="tx-big stop" onClick={stop}>■ Arrêter</button>
        </>
      )}
    </div>
  );
}
