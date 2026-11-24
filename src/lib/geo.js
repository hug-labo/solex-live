// Outils géométriques. Les coordonnées sont des tableaux [lat, lon].
// Pour les calculs, on projette localement en mètres (projection équirectangulaire),
// largement assez précise à l'échelle d'un circuit (< 10 km).

const R = 6371008.8; // rayon terrestre moyen (m)
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

/** Distance en mètres entre deux points [lat, lon] (haversine). */
export function distance(a, b) {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap (0-360°, 0 = nord) de a vers b. */
export function bearing(a, b) {
  const y = Math.sin(toRad(b[1] - a[1])) * Math.cos(toRad(b[0]));
  const x =
    Math.cos(toRad(a[0])) * Math.sin(toRad(b[0])) -
    Math.sin(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.cos(toRad(b[1] - a[1]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Crée une projection locale centrée sur `origin` : [lat,lon] <-> {x,y} en mètres. */
export function localProjection(origin) {
  const kx = R * Math.cos(toRad(origin[0]));
  return {
    toXY: (p) => ({ x: toRad(p[1] - origin[1]) * kx, y: toRad(p[0] - origin[0]) * R }),
    toLatLon: ({ x, y }) => [origin[0] + toDeg(y / R), origin[1] + toDeg(x / kx)],
  };
}

/**
 * Intersection de deux segments [p1,p2] et [q1,q2] (en {x,y}).
 * Retourne { t, u } (positions relatives sur chaque segment, 0..1) ou null.
 * `t` sert à interpoler l'instant de franchissement entre deux points GPS.
 */
export function segmentIntersection(p1, p2, q1, q2) {
  const rx = p2.x - p1.x, ry = p2.y - p1.y;
  const sx = q2.x - q1.x, sy = q2.y - q1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallèles
  const qpx = q1.x - p1.x, qpy = q1.y - p1.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Point dans polygone (ray casting) — en coordonnées [lat, lon]. */
export function pointInPolygon(p, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    const intersect =
      yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Longueur cumulée d'une polyligne (fermée si `closed`). */
export function cumulativeLengths(points, closed = true) {
  const cum = [0];
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    cum.push(cum[i] + distance(points[i], points[(i + 1) % n]));
  }
  return cum; // cum[cum.length-1] = longueur totale
}

/** Point situé à la distance `s` le long de la polyligne fermée. */
export function pointAtDistance(points, cum, s) {
  const total = cum[cum.length - 1];
  if (total <= 0) return { pos: points[0], heading: 0 };
  s = ((s % total) + total) % total;
  // recherche dichotomique du segment
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = points[lo % points.length];
  const b = points[(lo + 1) % points.length];
  const segLen = cum[lo + 1] - cum[lo];
  const f = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  return {
    pos: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    heading: bearing(a, b),
  };
}

/** Projette un point sur la polyligne fermée : renvoie l'abscisse curviligne la plus proche. */
export function nearestDistanceOnTrack(points, cum, p) {
  if (points.length < 2) return 0;
  const proj = localProjection(p);
  const P = { x: 0, y: 0 };
  let best = { d: Infinity, s: 0 };
  for (let i = 0; i < points.length; i++) {
    const A = proj.toXY(points[i]);
    const B = proj.toXY(points[(i + 1) % points.length]);
    const abx = B.x - A.x, aby = B.y - A.y;
    const len2 = abx * abx + aby * aby;
    const f = len2 > 0 ? Math.max(0, Math.min(1, ((P.x - A.x) * abx + (P.y - A.y) * aby) / len2)) : 0;
    const cx = A.x + abx * f, cy = A.y + aby * f;
    const d = Math.hypot(cx - P.x, cy - P.y);
    if (d < best.d) best = { d, s: cum[i] + f * (cum[i + 1] - cum[i]) };
  }
  return best.s;
}

/** Différence d'angle signée minimale (degrés, -180..180). */
export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}
