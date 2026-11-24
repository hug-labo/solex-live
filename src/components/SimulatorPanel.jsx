const MODES = {
  run: 'Roule',
  broken: 'En panne (arrêt en piste)',
  pitIn: 'Entrée aux stands',
  pitStop: 'Arrêt aux stands',
  pitOut: 'Sortie des stands',
};

export default function SimulatorPanel({ sim, simState, onReset }) {
  if (!simState) return null;
  const s = simState;

  if (!s.usable) {
    return (
      <div className="card sim">
        <div className="card-title">Simulateur</div>
        <p className="muted small">Dessinez un tracé d'au moins 3 points dans l'éditeur pour utiliser le simulateur.</p>
      </div>
    );
  }

  return (
    <div className="card sim">
      <div className="card-title">
        Simulateur <span className="muted small">· {MODES[s.mode]}{s.signalLost ? ' · signal coupé' : ''}</span>
      </div>

      <div className="sim-row">
        {s.running ? (
          <button onClick={() => sim.stop()}>⏸ Pause</button>
        ) : (
          <button className="primary" onClick={() => sim.start()}>▶ Lancer</button>
        )}
        <button className="ghost" onClick={onReset} title="Remet à zéro tours, alertes et position">⟲ Réinitialiser</button>
      </div>

      <label className="slider">
        <span>Vitesse max : <b>{s.speedSetKmh} km/h</b></span>
        <input type="range" min={40} max={110} step={5} value={s.speedSetKmh} onChange={(e) => sim.setSpeed(+e.target.value)} />
      </label>

      <div className="sim-row">
        <span className="muted small">Accélération du temps</span>
        {[1, 2, 5, 10].map((k) => (
          <button key={k} className={`chip ${s.timeScale === k ? 'on' : ''}`} onClick={() => sim.setTimeScale(k)}>×{k}</button>
        ))}
      </div>

      <div className="sim-row wrap">
        {s.mode === 'broken' ? (
          <button className="ok" onClick={() => sim.restart()}>Repartir</button>
        ) : (
          <button className="danger" disabled={s.mode !== 'run' || !s.running} onClick={() => sim.breakdown()}>
            Simuler une panne / un arrêt
          </button>
        )}
        {s.mode === 'pitStop' ? (
          <button className="ok" onClick={() => sim.restart()}>Ressortir des stands</button>
        ) : (
          <button disabled={!s.hasPit || s.mode !== 'run' || s.pitRequested || !s.running} onClick={() => sim.requestPit()}>
            {s.pitRequested ? 'Rentre au prochain passage…' : 'Passer aux stands'}
          </button>
        )}
        <button className={s.signalLost ? 'ok' : ''} disabled={!s.running} onClick={() => sim.setSignalLost(!s.signalLost)}>
          {s.signalLost ? 'Rétablir le signal' : 'Couper le signal'}
        </button>
      </div>
      <p className="muted small">
        Tracé : {(s.lengthM / 1000).toFixed(2)} km · 1 point GPS/s avec bruit ±1 m.
        {!s.hasPit && ' Pas de zone stands définie.'}
      </p>
    </div>
  );
}
