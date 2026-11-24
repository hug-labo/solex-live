import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import {
  CircleMarker, LayersControl, MapContainer, Marker, Polygon, Polyline, TileLayer, Tooltip,
  useMap, useMapEvents,
} from 'react-leaflet';

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SAT_ATTR = 'Imagerie © Esri, Maxar, Earthstar Geographics';
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '© contributeurs OpenStreetMap';

export default function MapView({ circuit, view, snapshot, editor, onMapClick, onChangeTrack, onChangePit, onMoveGate, focus }) {
  const editing = view === 'editor';
  const track = circuit?.track ?? [];
  const closedTrack = track.length > 2 ? [...track, track[0]] : track;
  const drawingTrack = editing && editor.tool === 'track';

  return (
    <MapContainer
      center={circuit?.center ?? [46.6, 2.4]}
      zoom={circuit?.zoom ?? 6}
      maxZoom={21}
      className={`map ${editing && editor.tool !== 'none' ? 'crosshair' : ''}`}
      zoomControl
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite">
          <TileLayer url={SAT_URL} attribution={SAT_ATTR} maxNativeZoom={19} maxZoom={21} />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Plan">
          <TileLayer url={OSM_URL} attribution={OSM_ATTR} maxNativeZoom={19} maxZoom={21} />
        </LayersControl.BaseLayer>
      </LayersControl>

      <FitCircuit circuit={circuit} />
      <AutoResize />
      <FocusOn focus={focus} />
      {editing && <ClickCatcher onClick={onMapClick} />}

      {/* Zone des stands */}
      {circuit?.pit?.length >= 2 && (
        <Polygon positions={circuit.pit} pathOptions={{ color: '#3b9cff', weight: 2, fillOpacity: 0.25, dashArray: '6 4' }}>
          <Tooltip permanent direction="center" className="lbl lbl-pit">STANDS</Tooltip>
        </Polygon>
      )}

      {/* Tracé */}
      {drawingTrack ? (
        // Pendant le dessin : tracé ouvert + fermeture en pointillés (simple aperçu)
        <>
          {track.length >= 2 && (
            <>
              <Polyline positions={track} pathOptions={{ color: '#000', weight: 9, opacity: 0.35 }} />
              <Polyline positions={track} pathOptions={{ color: '#ffd23f', weight: 4, opacity: 0.95 }} />
            </>
          )}
          {track.length >= 3 && (
            <Polyline
              positions={[track[track.length - 1], track[0]]}
              pathOptions={{ color: '#ffd23f', weight: 2, opacity: 0.7, dashArray: '4 8', interactive: false }}
            />
          )}
        </>
      ) : closedTrack.length >= 2 && (
        <>
          <Polyline positions={closedTrack} pathOptions={{ color: '#000', weight: 9, opacity: 0.35 }} />
          <Polyline positions={closedTrack} pathOptions={{ color: '#ffd23f', weight: 4, opacity: 0.95 }} />
        </>
      )}

      {/* Portes */}
      {circuit?.startFinish && <Gate gate={circuit.startFinish} label="DÉPART / ARRIVÉE" kind="sf" />}
      {circuit?.sectors?.map((g) => <Gate key={g.id} gate={g} label={g.name} kind="sector" />)}

      {editing && <EditorHandles circuit={circuit} editor={editor} onChangeTrack={onChangeTrack} onChangePit={onChangePit} onMoveGate={onMoveGate} />}

      {!editing && <LiveLayer snapshot={snapshot} />}
    </MapContainer>
  );
}

function Gate({ gate, label, kind }) {
  const sf = kind === 'sf';
  return (
    <>
      <Polyline positions={[gate.a, gate.b]} pathOptions={{ color: '#000', weight: sf ? 9 : 7, opacity: 0.6 }} />
      <Polyline
        positions={[gate.a, gate.b]}
        pathOptions={{ color: sf ? '#ffffff' : '#2de2e6', weight: sf ? 5 : 4, dashArray: sf ? '6 6' : null }}
      >
        <Tooltip permanent direction="top" offset={[0, -6]} className={`lbl ${sf ? 'lbl-sf' : 'lbl-sector'}`}>{label}</Tooltip>
      </Polyline>
    </>
  );
}

function LiveLayer({ snapshot }) {
  const p = snapshot.lastPoint;
  const icon = useMemo(() => {
    if (!p) return null;
    const cls = snapshot.status === 'alert' || snapshot.status === 'signal' ? 'danger' : snapshot.status === 'pit' ? 'pit' : '';
    const heading = p.heading ?? 0;
    return L.divIcon({
      className: 'solex-icon',
      iconSize: [0, 0],
      html: `<div class="solex ${cls}">
               <div class="arrow" style="transform: rotate(${heading}deg)"></div>
               <div class="spd">${Math.round(snapshot.speedKmh)}<small> km/h</small></div>
             </div>`,
    });
  }, [p, snapshot.status, snapshot.speedKmh]);

  return (
    <>
      {snapshot.trail.length > 1 && (
        <Polyline positions={snapshot.trail} pathOptions={{ color: '#ff7a1a', weight: 4, opacity: 0.85 }} />
      )}
      {snapshot.alerts.map((a) => (
        <Marker
          key={a.type}
          position={a.pos}
          icon={L.divIcon({ className: 'alert-pin', iconSize: [0, 0], html: '<div class="pulse"></div><div class="dot">!</div>' })}
        >
          <Tooltip permanent direction="right" offset={[14, 0]} className="lbl lbl-alert">
            {a.type === 'stop' ? 'ARRÊT ICI' : 'DERNIÈRE POSITION'}
          </Tooltip>
        </Marker>
      ))}
      {p && icon && <Marker position={[p.lat, p.lon]} icon={icon} zIndexOffset={1000} />}
    </>
  );
}

const ICONS = {
  track: L.divIcon({ className: 'vertex', iconSize: [12, 12] }),
  pit: L.divIcon({ className: 'vertex pit', iconSize: [12, 12] }),
  mid: L.divIcon({ className: 'vertex mid', iconSize: [10, 10] }),
  gate: L.divIcon({ className: 'vertex gate', iconSize: [12, 12] }),
  gateSf: L.divIcon({ className: 'vertex gate sf', iconSize: [12, 12] }),
};

// Points déplaçables (glisser), supprimables (clic droit / appui long),
// et poignées « + » au milieu de chaque segment pour insérer un point.
function EditablePoints({ points, closed, icon, onChange }) {
  const n = points.length;
  const segs = closed && n > 2 ? n : n - 1;
  const mids = [];
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % n];
    mids.push({ i, pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
  }
  return (
    <>
      {mids.map(({ i, pos }) => (
        <Marker
          key={'m' + i + ':' + n}
          position={pos}
          icon={ICONS.mid}
          draggable
          eventHandlers={{
            click: () => onChange(insertAt(points, i + 1, pos)),
            dragend: (e) => onChange(insertAt(points, i + 1, ll(e.target.getLatLng()))),
          }}
        >
          <Tooltip direction="top">Cliquer ou glisser pour insérer un point</Tooltip>
        </Marker>
      ))}
      {points.map((p, i) => (
        <Marker
          key={'v' + i + ':' + n}
          position={p}
          icon={icon}
          draggable
          eventHandlers={{
            dragend: (e) => onChange(points.map((q, j) => (j === i ? ll(e.target.getLatLng()) : q))),
            contextmenu: (e) => {
              L.DomEvent.preventDefault(e.originalEvent);
              onChange(points.filter((_, j) => j !== i));
            },
          }}
        />
      ))}
    </>
  );
}

function EditorHandles({ circuit, editor, onChangeTrack, onChangePit, onMoveGate }) {
  const gateHandles = (g, id, icon) => ['a', 'b'].map((end) => (
    <Marker
      key={id + end}
      position={g[end]}
      icon={icon}
      draggable
      eventHandlers={{ dragend: (e) => onMoveGate(id, end, ll(e.target.getLatLng())) }}
    />
  ));
  return (
    <>
      {editor.tool === 'track' && <EditablePoints points={circuit.track} closed={false} icon={ICONS.track} onChange={onChangeTrack} />}
      {editor.tool === 'pit' && <EditablePoints points={circuit.pit || []} closed icon={ICONS.pit} onChange={onChangePit} />}
      {editor.tool === 'start' && circuit.startFinish && gateHandles(circuit.startFinish, 'SF', ICONS.gateSf)}
      {editor.tool === 'sector' && circuit.sectors.map((g) => gateHandles(g, g.id, ICONS.gate))}
      {editor.tool === 'track' && circuit.track.length > 0 && (
        <CircleMarker center={circuit.track[0]} radius={9} pathOptions={{ color: '#ffd23f', weight: 3, fillOpacity: 0 }}>
          <Tooltip direction="top">Premier point (sens de roulage →)</Tooltip>
        </CircleMarker>
      )}
      {editor.pending && (
        <CircleMarker center={editor.pending} radius={7} pathOptions={{ color: '#fff', fillColor: '#2de2e6', fillOpacity: 1 }}>
          <Tooltip permanent direction="top" className="lbl">Cliquez l'autre extrémité</Tooltip>
        </CircleMarker>
      )}
    </>
  );
}

function ClickCatcher({ onClick }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}

// Recadre la carte quand on change de circuit.
function FitCircuit({ circuit }) {
  const map = useMap();
  const lastId = useRef(null);
  useEffect(() => {
    if (!circuit || lastId.current === circuit.id) return;
    lastId.current = circuit.id;
    const pts = [...(circuit.track || []), ...(circuit.pit || [])];
    if (pts.length >= 2) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    else if (circuit.center) map.setView(circuit.center, circuit.zoom ?? 16);
  }, [circuit, map]);
  return null;
}

// La carte change de taille (bandeau d'alerte, rotation tablette) : on prévient Leaflet.
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function FocusOn({ focus }) {
  const map = useMap();
  useEffect(() => {
    if (focus?.pos) map.flyTo(focus.pos, Math.max(map.getZoom(), focus.zoom ?? 17), { duration: 0.8 });
  }, [focus, map]);
  return null;
}

const insertAt = (arr, i, p) => [...arr.slice(0, i), p, ...arr.slice(i)];
const ll = (latlng) => [Math.round(latlng.lat * 1e7) / 1e7, Math.round(latlng.lng * 1e7) / 1e7];
