import { useEffect, useState } from 'react';
import { fmtClock, fmtDelta, fmtDuration, fmtLap } from '../lib/format.js';
import SimulatorPanel from './SimulatorPanel.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import OnlinePanel from './OnlinePanel.jsx';
import { STATUS } from './status.js';
import { exportLapsCsv } from '../lib/storage.js';

export default function Dashboard({
  snapshot, tracker, sim, simState, circuit, onReset, onBigScreen, onSettings,
  online, liveStatus, apiKind, onCreateOnline, onJoinOnline, onLeaveOnline,
}) {
  const onlinePanel = (
    <OnlinePanel
      online={online}
      status={liveStatus}
      apiKind={apiKind}
      circuit={circuit}
      onCreate={onCreateOnline}
      onJoin={onJoinOnline}
      onLeave={onLeaveOnline}
    />
  );
  const st = STATUS[snapshot.status];
  const nSectors = (circuit?.sectors?.length ?? 0) + 1;
  const { lastLap, bestLap, bestSectors, currentLap, liveDelta } = snapshot;

  return (
    <div className="dash">
      <div className="row status-row">
        <div className={`status ${st.cls}`}>{st.label}</div>
        <div className="speed">
          <span className="speed-val">{snapshot.lastPoint ? Math.round(snapshot.speedKmh) : '–'}</span>
          <span className="speed-unit">km/h</span>
        </div>
      </div>

      <PitLine tracker={tracker} snapshot={snapshot} />

      {online && onlinePanel}

      {!circuit?.startFinish && (
        <p className="warn">Ce circuit n'a pas de ligne de départ/arrivée : le chronométrage est inactif. Ajoutez-la dans l'éditeur.</p>
      )}

      <div className="card current">
        <div className="card-title">
          Tour en cours {currentLap ? <b>#{currentLap.number}</b> : <span className="muted">(tour de lancement)</span>}
          {currentLap?.pit && <span className="tag pit">stand</span>}
          <span className="spacer" />
          <button className="small" onClick={onBigScreen} title="Affichage géant pour l'équipe aux stands">⛶ Écran stands</button>
        </div>
        <LiveLapTimer tracker={tracker} start={currentLap?.start} />
        {liveDelta && (
          <div className="live-delta">
            <span className={`delta ${liveDelta.delta > 0 ? 'slower' : 'faster'}`}>{fmtDelta(liveDelta.delta)}</span>
            <span className="muted small">vs meilleur tour, au passage de S{liveDelta.gate + 1}</span>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-title">Dernier tour</div>
          <div className="time">{fmtLap(lastLap?.time)}</div>
          {lastLap && bestLap && lastLap !== bestLap && !lastLap.pit && (
            <div className={`delta ${lastLap.time - bestLap.time > 0 ? 'slower' : 'faster'}`}>
              {fmtDelta(lastLap.time - bestLap.time)} vs meilleur
            </div>
          )}
          {lastLap?.pit && <div className="delta muted">tour avec passage aux stands</div>}
        </div>
        <div className="card best">
          <div className="card-title">Meilleur tour</div>
          <div className="time">{fmtLap(bestLap?.time)}</div>
          {bestLap && <div className="delta muted">tour #{bestLap.number}</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Secteurs</div>
        <table className="tbl sectors">
          <thead>
            <tr>
              <th></th>
              {Array.from({ length: nSectors }, (_, i) => <th key={i}>S{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="muted">En cours</td>
              {currentSectors(currentLap, nSectors).map((v, i) => (
                <td key={i} className={sectorClass(v, bestSectors[i])}>{v != null ? fmtLap(v) : '·'}</td>
              ))}
            </tr>
            <tr>
              <td className="muted">Dernier</td>
              {Array.from({ length: nSectors }, (_, i) => {
                const v = lastLap?.sectors[i];
                return <td key={i} className={sectorClass(v, bestSectors[i])}>{fmtLap(v)}</td>;
              })}
            </tr>
            <tr>
              <td className="muted">Meilleur</td>
              {bestSectors.map((v, i) => <td key={i} className="best-txt">{fmtLap(v)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <PitStopsCard tracker={tracker} snapshot={snapshot} />

      {!online && (
        <>
          <SimulatorPanel sim={sim} simState={simState} onReset={onReset} />
          {onlinePanel}
        </>
      )}

      <div className="card">
        <div className="card-title">
          Tours ({snapshot.laps.length})
          <span className="spacer" />
          <button
            className="small"
            disabled={!snapshot.laps.length}
            onClick={() => exportLapsCsv(snapshot.laps, circuit?.name, nSectors)}
            title="Télécharger les tours (Excel / tableur)"
          >
            ⤓ CSV
          </button>
        </div>
        {snapshot.laps.length === 0 ? (
          <p className="muted small">Aucun tour bouclé pour l'instant.</p>
        ) : (
          <div className="scroll">
            <table className="tbl laps">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Temps</th>
                  {Array.from({ length: nSectors }, (_, i) => <th key={i}>S{i + 1}</th>)}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...snapshot.laps].reverse().map((l) => (
                  <tr key={l.number} className={l === bestLap ? 'best-row' : ''}>
                    <td>{l.number}</td>
                    <td className="mono strong">{fmtLap(l.time)}</td>
                    {l.sectors.map((v, i) => (
                      <td key={i} className={`mono ${v != null && v === bestSectors[i] ? 'best-txt' : ''}`}>{fmtLap(v)}</td>
                    ))}
                    <td>{l.pit && <span className="tag pit">stand</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Incidents ({snapshot.incidents.length})</div>
        {snapshot.incidents.length === 0 ? (
          <p className="muted small">Aucun incident.</p>
        ) : (
          <ul className="incidents">
            {snapshot.incidents.map((inc, i) => (
              <li key={i}>
                <span className="mono">{fmtClock(inc.since)}</span>{' '}
                {inc.type === 'stop' ? 'Arrêt en piste' : 'Perte de signal'} — {fmtDuration(inc.duration)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SettingsPanel settings={snapshot.settings} onChange={onSettings} />
    </div>
  );
}

function LiveLapTimer({ tracker, start }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 100);
    return () => clearInterval(id);
  }, []);
  const now = tracker.clockNow();
  const v = start != null && now != null ? Math.max(0, now - start) : null;
  return <div className="time big">{fmtLap(v, 1)}</div>;
}

// Rafraîchit le composant toutes les `ms` (chronos qui tournent entre deux points GPS).
function useTick(ms) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

// Bandeau sous l'état : arrêt en cours (chrono + heure d'entrée) ou résumé du dernier arrêt.
function PitLine({ tracker, snapshot }) {
  useTick(500);
  const { currentPit, pitStops, pitTotal } = snapshot;
  const now = tracker.clockNow();
  const last = pitStops[pitStops.length - 1];
  const total = pitTotal + (currentPit && now != null ? Math.max(0, now - currentPit.in) : 0);

  if (currentPit) {
    return (
      <div className="pit-line active">
        <span>
          ⏱ Arrêt #{currentPit.number} aux stands depuis{' '}
          <b className="mono">{fmtDuration(now != null ? Math.max(0, now - currentPit.in) : 0)}</b>
        </span>
        <span className="small">entrée à <b className="mono">{fmtClock(currentPit.in)}</b> · total stands {fmtDuration(total)}</span>
      </div>
    );
  }
  if (!last) return null;
  return (
    <div className="pit-line">
      <span>
        Dernier arrêt : <b className="mono">{fmtClock(last.in)}</b> → <b className="mono">{fmtClock(last.out)}</b>{' '}
        ({fmtDuration(last.duration)})
      </span>
      <span className="small">{pitStops.length} arrêt(s) · total stands {fmtDuration(total)}</span>
    </div>
  );
}

function PitStopsCard({ tracker, snapshot }) {
  useTick(1000);
  const { currentPit, pitStops, pitTotal } = snapshot;
  const now = tracker.clockNow();
  const curDur = currentPit && now != null ? Math.max(0, now - currentPit.in) : 0;
  const n = pitStops.length + (currentPit ? 1 : 0);
  return (
    <div className="card">
      <div className="card-title">
        Arrêts aux stands ({n})
        <span className="spacer" />
        {n > 0 && <span className="muted small">total {fmtDuration(pitTotal + curDur)}</span>}
      </div>
      {n === 0 ? (
        <p className="muted small">Aucun passage aux stands.</p>
      ) : (
        <div className="scroll">
          <table className="tbl laps">
            <thead>
              <tr>
                <th>#</th>
                <th>Entrée</th>
                <th>Sortie</th>
                <th>Durée</th>
                <th>Tour</th>
              </tr>
            </thead>
            <tbody>
              {currentPit && (
                <tr className="pit-row">
                  <td>{currentPit.number}</td>
                  <td className="mono">{fmtClock(currentPit.in)}</td>
                  <td><span className="tag pit">en cours</span></td>
                  <td className="mono strong">{fmtDuration(curDur)}</td>
                  <td>{currentPit.lap || '—'}</td>
                </tr>
              )}
              {[...pitStops].reverse().map((s) => (
                <tr key={s.number}>
                  <td>{s.number}</td>
                  <td className="mono">{fmtClock(s.in)}</td>
                  <td className="mono">{fmtClock(s.out)}</td>
                  <td className="mono strong">{fmtDuration(s.duration)}</td>
                  <td>{s.lap || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function currentSectors(lap, n) {
  const out = new Array(n).fill(null);
  if (!lap) return out;
  const bounds = [lap.start, ...lap.sectorCross];
  for (let i = 0; i < n - 1; i++) {
    const a = bounds[i], b = bounds[i + 1];
    if (a != null && b != null && b > a) out[i] = b - a;
  }
  return out;
}

function sectorClass(v, best) {
  if (v == null || best == null) return 'mono';
  if (v <= best) return 'mono best-txt';
  return v - best < 500 ? 'mono near' : 'mono slow';
}
