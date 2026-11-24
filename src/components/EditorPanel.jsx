import { useRef, useState } from 'react';
import { emptyCircuit, makeDemoCircuit } from '../lib/demoCircuit.js';
import { exportCircuit, importCircuitFile } from '../lib/storage.js';
import { cumulativeLengths } from '../lib/geo.js';

const TOOLS = [
  { id: 'none', label: 'Déplacer la carte', help: 'Naviguez librement. Choisissez un outil pour dessiner.' },
  { id: 'track', label: 'Tracé', help: 'Cliquez le long de la piste, dans le sens de roulage, jusqu\'à revenir près du premier point (cercle jaune). La fermeture est montrée en pointillés et se fait automatiquement. Glissez un point pour le déplacer, clic droit (appui long sur tablette) pour le supprimer, et cliquez une petite poignée blanche pour insérer un point au milieu d\'un segment.' },
  { id: 'start', label: 'Départ / Arrivée', help: 'Cliquez les deux extrémités de la ligne, de part et d\'autre de la piste (débordez de quelques mètres). Glissez les extrémités carrées pour ajuster la ligne existante.' },
  { id: 'sector', label: 'Porte secteur', help: 'Cliquez les deux extrémités d\'une nouvelle porte. Glissez les extrémités carrées pour déplacer une porte existante. La numérotation suit l\'ordre de passage.' },
  { id: 'pit', label: 'Zone stands', help: 'Cliquez les sommets du polygone des stands. Mêmes gestes que le tracé (glisser, clic droit, poignées d\'insertion). Aucune alerte d\'arrêt à l\'intérieur.' },
];

export default function EditorPanel({ circuit, circuits, editor, setEditor, updateCircuit, setCircuits, setActiveId, onGoTo }) {
  const fileRef = useRef(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [msg, setMsg] = useState('');

  const tool = TOOLS.find((t) => t.id === editor.tool);
  const lengthKm = circuit.track.length > 2 ? cumulativeLengths(circuit.track, true).at(-1) / 1000 : 0;

  const addCircuit = (c) => {
    setCircuits((list) => [...list, c]);
    setActiveId(c.id);
  };

  const search = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setMsg('Recherche…');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } });
      const data = await res.json();
      setResults(data);
      setMsg(data.length ? '' : 'Aucun résultat');
    } catch {
      setMsg('Recherche impossible (pas de connexion ?)');
    }
  };

  const locateMe = () => {
    if (!navigator.geolocation) return setMsg('Géolocalisation indisponible');
    navigator.geolocation.getCurrentPosition(
      (p) => onGoTo([p.coords.latitude, p.coords.longitude]),
      () => setMsg('Position refusée ou indisponible'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const moveSector = (i, dir) => {
    const s = [...circuit.sectors];
    const j = i + dir;
    if (j < 0 || j >= s.length) return;
    [s[i], s[j]] = [s[j], s[i]];
    updateCircuit({ sectors: renumber(s) });
  };

  const onImport = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      addCircuit(await importCircuitFile(f));
      setMsg('Circuit importé');
    } catch (err) {
      setMsg(err.message);
    }
  };

  const remove = () => {
    if (!confirm(`Supprimer le circuit « ${circuit.name} » ?`)) return;
    const rest = circuits.filter((c) => c.id !== circuit.id);
    const next = rest.length ? rest : [makeDemoCircuit()];
    setCircuits(next);
    setActiveId(next[0].id);
  };

  return (
    <div className="editor">
      <div className="card">
        <div className="card-title">Circuit</div>
        <input className="name" value={circuit.name} onChange={(e) => updateCircuit({ name: e.target.value })} />
        <p className="muted small">
          Longueur : {lengthKm ? `${lengthKm.toFixed(2)} km` : '—'} · {circuit.track.length} points ·{' '}
          {circuit.sectors.length} secteur(s) · enregistré automatiquement
        </p>
        <div className="sim-row wrap">
          <button onClick={() => addCircuit(emptyCircuit(circuit.center, circuit.zoom))}>+ Nouveau</button>
          <button onClick={() => addCircuit({ ...structuredClone(circuit), id: 'c' + Date.now().toString(36), name: circuit.name + ' (copie)' })}>Dupliquer</button>
          <button onClick={() => exportCircuit(circuit)}>Exporter</button>
          <button onClick={() => fileRef.current?.click()}>Importer</button>
          <button className="danger ghost" onClick={remove}>Supprimer</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={onImport} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Trouver le circuit</div>
        <form className="search" onSubmit={search}>
          <input placeholder="Ville, adresse, nom du circuit…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="submit">Chercher</button>
        </form>
        <div className="sim-row">
          <button className="ghost" onClick={locateMe}>📍 Ma position</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
        {results.length > 0 && (
          <ul className="results">
            {results.map((r) => (
              <li key={r.place_id}>
                <button className="link" onClick={() => { onGoTo([+r.lat, +r.lon]); setResults([]); }}>{r.display_name}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="card-title">Outils de dessin</div>
        <div className="tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`chip ${editor.tool === t.id ? 'on' : ''}`}
              onClick={() => setEditor({ tool: t.id, pending: null })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <p className="help">{tool?.help}</p>

        {editor.tool === 'track' && (
          <div className="sim-row wrap">
            <button disabled={!circuit.track.length} onClick={() => updateCircuit({ track: circuit.track.slice(0, -1) })}>↶ Retirer le dernier point</button>
            <button disabled={circuit.track.length < 3} onClick={() => updateCircuit({ track: [...circuit.track].reverse() })}>⇄ Inverser le sens</button>
            <button className="danger ghost" disabled={!circuit.track.length} onClick={() => confirm('Effacer tout le tracé ?') && updateCircuit({ track: [] })}>Effacer le tracé</button>
          </div>
        )}
        {editor.tool === 'pit' && (
          <div className="sim-row wrap">
            <button disabled={!circuit.pit?.length} onClick={() => updateCircuit({ pit: circuit.pit.slice(0, -1) })}>↶ Retirer le dernier point</button>
            <button className="danger ghost" disabled={!circuit.pit?.length} onClick={() => updateCircuit({ pit: [] })}>Effacer la zone</button>
          </div>
        )}
        {editor.pending && (
          <div className="sim-row">
            <button className="ghost" onClick={() => setEditor({ ...editor, pending: null })}>Annuler cette porte</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Portes</div>
        <ul className="gates">
          <li>
            <span className="gate-dot sf" /> Départ / Arrivée
            <span className="spacer" />
            {circuit.startFinish ? (
              <button className="ghost small" onClick={() => updateCircuit({ startFinish: null })}>Supprimer</button>
            ) : (
              <span className="muted small">non placée</span>
            )}
          </li>
          {circuit.sectors.map((g, i) => (
            <li key={g.id}>
              <span className="gate-dot" /> {g.name}
              <span className="spacer" />
              <button className="ghost small" onClick={() => moveSector(i, -1)} disabled={i === 0} title="Monter">↑</button>
              <button className="ghost small" onClick={() => moveSector(i, 1)} disabled={i === circuit.sectors.length - 1} title="Descendre">↓</button>
              <button className="ghost small" onClick={() => updateCircuit({ sectors: renumber(circuit.sectors.filter((x) => x.id !== g.id)) })}>Supprimer</button>
            </li>
          ))}
        </ul>
        <p className="muted small">
          {circuit.sectors.length + 1} secteurs chronométrés. Zone stands : {circuit.pit?.length >= 3 ? 'définie' : 'non définie'}.
        </p>
      </div>

      <p className="muted small">Les modifications s'appliquent au suivi en revenant sur l'onglet Live (la session en cours est alors remise à zéro).</p>
    </div>
  );
}

const renumber = (sectors) => sectors.map((s, i) => ({ ...s, name: 'S' + (i + 1) }));
