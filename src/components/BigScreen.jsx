import { useEffect, useState } from 'react';
import { fmtDelta, fmtDuration, fmtLap } from '../lib/format.js';
import { STATUS } from './status.js';

// Écran des stands : l'essentiel en très gros, lisible à plusieurs mètres.
export default function BigScreen({ snapshot, tracker, onClose }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(id);
  }, []);

  // Plein écran du navigateur ; quitter le plein écran (Échap) ferme la vue.
  useEffect(() => {
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    const onFs = () => { if (!document.fullscreenElement) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [onClose]);

  const st = STATUS[snapshot.status];
  const now = tracker.clockNow();
  const lap = snapshot.currentLap;
  const elapsed = lap && now != null ? Math.max(0, now - lap.start) : null;
  const { lastLap, bestLap, liveDelta } = snapshot;
  const lastDelta = lastLap && bestLap && lastLap !== bestLap && !lastLap.pit ? lastLap.time - bestLap.time : null;
  const alert = snapshot.alerts[0];

  return (
    <div className={`bigscreen ${snapshot.needsSound ? 'alarm' : ''}`}>
      <div className="big-top">
        <div className={`status big-status ${st.cls}`}>{st.label}</div>
        <div className="big-speed">
          {snapshot.lastPoint ? Math.round(snapshot.speedKmh) : '–'}<small>km/h</small>
        </div>
      </div>

      <div className="big-main">
        {alert ? (
          <div className="big-alert">
            ⚠ {alert.type === 'stop' ? 'ARRÊT EN PISTE' : 'PERTE DE SIGNAL'} — {fmtDuration(now != null ? now - alert.since : null)}
          </div>
        ) : null}
        <div className="big-label">Tour {lap ? lap.number : '—'}</div>
        <div className="big-timer">{fmtLap(elapsed, 1)}</div>
        {liveDelta && (
          <div className={`big-delta ${liveDelta.delta > 0 ? 'slower' : 'faster'}`}>
            {fmtDelta(liveDelta.delta)} <span className="big-label">S{liveDelta.gate + 1}</span>
          </div>
        )}
      </div>

      <div className="big-bottom">
        <div className="big-cell">
          <div className="big-label">Dernier {lastDelta != null && <span className={lastDelta > 0 ? 'slow' : 'near'}>{fmtDelta(lastDelta)}</span>}</div>
          <div className="v">{fmtLap(lastLap?.time)}</div>
        </div>
        <div className="big-cell best">
          <div className="big-label">Meilleur</div>
          <div className="v">{fmtLap(bestLap?.time)}</div>
        </div>
        <div className="big-actions">
          {snapshot.needsSound && <button className="ack" onClick={() => tracker.acknowledge()}>ACQUITTER</button>}
          <button onClick={onClose}>✕ Quitter (Échap)</button>
        </div>
      </div>
    </div>
  );
}
