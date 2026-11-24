const FIELDS = [
  { key: 'stopSpeedKmh', label: 'Seuil d\'arrêt (km/h)', min: 1, max: 20, step: 0.5 },
  { key: 'stopDelayS', label: 'Délai avant alerte d\'arrêt (s)', min: 2, max: 120, step: 1 },
  { key: 'signalTimeoutS', label: 'Délai avant alerte perte de signal (s)', min: 2, max: 120, step: 1 },
  { key: 'trailSeconds', label: 'Longueur du fil d\'Ariane (s)', min: 5, max: 300, step: 5 },
];

export default function SettingsPanel({ settings, onChange }) {
  return (
    <details className="card">
      <summary>
        <div className="card-title"><span className="chev">▸</span> Réglages des alertes</div>
      </summary>
      {FIELDS.map((f) => (
        <label key={f.key} className="setting">
          <span>{f.label}</span>
          <input
            type="number"
            min={f.min}
            max={f.max}
            step={f.step}
            value={settings[f.key]}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v) && v >= f.min && v <= f.max) onChange({ [f.key]: v });
            }}
          />
        </label>
      ))}
      <p className="muted small">Appliqués immédiatement, sans remettre la session à zéro. Mémorisés sur cet appareil.</p>
    </details>
  );
}
