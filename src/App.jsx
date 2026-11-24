import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import MapView from './components/MapView.jsx';
import Dashboard from './components/Dashboard.jsx';
import EditorPanel from './components/EditorPanel.jsx';
import AlertBanner from './components/AlertBanner.jsx';
import { RaceTracker } from './lib/tracker.js';
import { Simulator } from './lib/simulator.js';
import { makeDemoCircuit } from './lib/demoCircuit.js';
import BigScreen from './components/BigScreen.jsx';
import {
  loadActiveId, loadCircuits, loadSettings, loadTheme, saveActiveId, saveCircuits, saveSettings, saveTheme,
} from './lib/storage.js';
import { audioReady, playAlarm, unlockAudio } from './lib/sound.js';
import { cumulativeLengths, nearestDistanceOnTrack } from './lib/geo.js';

function initialCircuits() {
  const saved = loadCircuits();
  return saved.length ? saved : [makeDemoCircuit()];
}

export default function App() {
  const [circuits, setCircuits] = useState(initialCircuits);
  const [activeId, setActiveId] = useState(() => loadActiveId());
  const [view, setView] = useState('live');
  const [soundOn, setSoundOn] = useState(false);
  const [focus, setFocus] = useState(null); // position à centrer sur la carte
  const [editor, setEditor] = useState({ tool: 'none', pending: null });
  const [bigScreen, setBigScreen] = useState(false);
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  const circuit = circuits.find((c) => c.id === activeId) ?? circuits[0];

  // Persistance automatique
  useEffect(() => { saveCircuits(circuits); }, [circuits]);
  useEffect(() => { if (circuit) saveActiveId(circuit.id); }, [circuit]);

  const updateCircuit = useCallback((patch) => {
    setCircuits((list) => list.map((c) => (c.id === circuit.id ? { ...c, ...patch, updatedAt: Date.now() } : c)));
  }, [circuit?.id]);

  // ---------- moteur de suivi + simulateur ----------
  const tracker = useMemo(() => new RaceTracker(circuit, loadSettings()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const changeSettings = useCallback((patch) => {
    tracker.updateSettings(patch);
    saveSettings(tracker.settings);
  }, [tracker]);
  const closeBigScreen = useCallback(() => setBigScreen(false), []);
  const snapshot = useSyncExternalStore(
    useCallback((fn) => tracker.subscribe(fn), [tracker]),
    () => tracker.getSnapshot(),
  );

  const [simState, setSimState] = useState(null);
  const sim = useMemo(
    () => {
      const s = new Simulator(circuit, (p) => {
        tracker.setTimeScale(s.timeScale);
        tracker.push(p);
      }, setSimState);
      return s;
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => { sim.resetState(); }, [sim]); // publie l'état initial du simulateur
  useEffect(() => () => sim.stop(), [sim]);

  // Le circuit n'est appliqué au suivi qu'en revenant sur l'onglet Live
  // (éditer ne réinitialise pas la session en cours à chaque clic).
  const appliedRef = useRef(circuit);
  useEffect(() => {
    if (view !== 'live' || appliedRef.current === circuit) return;
    appliedRef.current = circuit;
    sim.setCircuit(circuit);
    tracker.setCircuit(circuit);
  }, [view, circuit, sim, tracker]);

  const resetSession = useCallback(() => {
    sim.stop();
    sim.resetState();
    tracker.reset();
  }, [sim, tracker]);

  // Détection de perte de signal (horloge murale)
  useEffect(() => {
    const id = setInterval(() => tracker.tick(), 500);
    return () => clearInterval(id);
  }, [tracker]);

  // ---------- alarme sonore ----------
  useEffect(() => {
    const unlock = () => setSoundOn(unlockAudio());
    window.addEventListener('pointerdown', unlock);
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (!snapshot.needsSound) return;
    const ring = () => { if (audioReady()) playAlarm(); };
    ring();
    const id = setInterval(ring, 1400);
    return () => clearInterval(id);
  }, [snapshot.needsSound]);

  // ---------- éditeur : clics sur la carte ----------
  const onMapClick = useCallback((latlng) => {
    const p = [round(latlng.lat), round(latlng.lng)];
    const { tool, pending } = editor;
    if (tool === 'track') updateCircuit({ track: [...circuit.track, p] });
    else if (tool === 'pit') updateCircuit({ pit: [...(circuit.pit || []), p] });
    else if (tool === 'start' || tool === 'sector') {
      if (!pending) { setEditor({ tool, pending: p }); return; }
      const gate = { a: pending, b: p };
      if (tool === 'start') updateCircuit({ startFinish: gate });
      else {
        const sectors = [...circuit.sectors, { id: 'S' + Date.now().toString(36), ...gate }];
        updateCircuit({ sectors: orderSectors(circuit, sectors) });
      }
      setEditor({ tool, pending: null });
    }
  }, [editor, circuit, updateCircuit]);

  const alertActive = snapshot.alerts.length > 0;

  return (
    <div className={`app ${alertActive ? (snapshot.needsSound ? 'alarm' : 'alarm-ack') : ''}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">◢</span> Solex Live
        </div>
        <nav className="tabs">
          <button className={view === 'live' ? 'on' : ''} onClick={() => setView('live')}>Live</button>
          <button className={view === 'editor' ? 'on' : ''} onClick={() => setView('editor')}>Éditeur de circuit</button>
        </nav>
        <div className="topbar-right">
          <select value={circuit?.id} onChange={(e) => setActiveId(e.target.value)} title="Circuit actif">
            {circuits.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title="Thème clair à fort contraste pour le plein soleil"
          >
            {theme === 'light' ? '☾ Sombre' : '☀ Plein soleil'}
          </button>
          <button
            className={`sound ${soundOn ? 'ok' : 'off'}`}
            onClick={() => { const ok = unlockAudio(); setSoundOn(ok); if (ok) playAlarm(); }}
            title="Tester l'alarme sonore"
          >
            {soundOn ? '🔊 Son actif' : '🔇 Activer le son'}
          </button>
        </div>
      </header>

      {view === 'live' && alertActive && (
        <AlertBanner
          alerts={snapshot.alerts}
          clockNow={() => tracker.clockNow()}
          onAck={() => tracker.acknowledge()}
          onLocate={(pos) => setFocus({ pos, at: Date.now() })}
        />
      )}

      <main className="layout">
        <section className="map-wrap">
          <MapView
            circuit={circuit}
            view={view}
            snapshot={snapshot}
            editor={editor}
            onMapClick={onMapClick}
            onChangeTrack={(track) => updateCircuit({ track })}
            onChangePit={(pit) => updateCircuit({ pit })}
            onMoveGate={(id, end, p) => {
              if (id === 'SF') updateCircuit({ startFinish: { ...circuit.startFinish, [end]: p } });
              else {
                const sectors = circuit.sectors.map((g) => (g.id === id ? { ...g, [end]: p } : g));
                updateCircuit({ sectors: orderSectors(circuit, sectors) });
              }
            }}
            focus={focus}
          />
        </section>
        <aside className="side">
          {view === 'live' ? (
            <Dashboard
              snapshot={snapshot}
              tracker={tracker}
              sim={sim}
              simState={simState}
              circuit={circuit}
              onReset={resetSession}
              onBigScreen={() => setBigScreen(true)}
              onSettings={changeSettings}
            />
          ) : (
            <EditorPanel
              circuit={circuit}
              circuits={circuits}
              editor={editor}
              setEditor={setEditor}
              updateCircuit={updateCircuit}
              setCircuits={setCircuits}
              setActiveId={setActiveId}
              onGoTo={(pos) => setFocus({ pos, zoom: 16, at: Date.now() })}
            />
          )}
        </aside>
      </main>

      {bigScreen && <BigScreen snapshot={snapshot} tracker={tracker} onClose={closeBigScreen} />}
    </div>
  );
}

const round = (x) => Math.round(x * 1e7) / 1e7;

// Trie les portes secteur dans l'ordre de passage (distance le long du tracé depuis la ligne d'arrivée)
// puis les renumérote S1, S2…
function orderSectors(circuit, sectors) {
  const track = circuit.track;
  if (track.length >= 3) {
    const cum = cumulativeLengths(track, true);
    const L = cum[cum.length - 1];
    const mid = (g) => [(g.a[0] + g.b[0]) / 2, (g.a[1] + g.b[1]) / 2];
    const s0 = circuit.startFinish ? nearestDistanceOnTrack(track, cum, mid(circuit.startFinish)) : 0;
    const key = (g) => (nearestDistanceOnTrack(track, cum, mid(g)) - s0 + L) % L;
    sectors = [...sectors].sort((x, y) => key(x) - key(y));
  }
  return sectors.map((s, i) => ({ ...s, name: 'S' + (i + 1) }));
}
