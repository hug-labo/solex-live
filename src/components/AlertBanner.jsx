import { useEffect, useState } from 'react';
import { fmtDuration } from '../lib/format.js';

const LABELS = {
  stop: 'ARRÊT EN PISTE',
  signal: 'PERTE DE SIGNAL',
};

export default function AlertBanner({ alerts, clockNow, onAck, onLocate }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, []);

  const now = clockNow();
  const unacked = alerts.some((a) => !a.acknowledged);

  return (
    <div className={`alert-banner ${unacked ? 'blink' : ''}`} role="alert">
      <div className="alert-list">
        {alerts.map((a) => (
          <div key={a.type} className="alert-item">
            <span className="alert-icon">⚠</span>
            <strong>{LABELS[a.type]}</strong>
            <span className="alert-since">
              {a.type === 'stop' ? 'immobile depuis ' : 'aucune donnée depuis '}
              {fmtDuration(now != null ? now - a.since : null)}
            </span>
            <button className="ghost" onClick={() => onLocate(a.pos)}>Voir sur la carte</button>
          </div>
        ))}
      </div>
      {unacked ? (
        <button className="ack" onClick={onAck}>ACQUITTER · couper le son</button>
      ) : (
        <span className="acked">Acquittée — en attente de reprise</span>
      )}
    </div>
  );
}
