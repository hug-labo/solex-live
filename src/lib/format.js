/** 83456 ms -> "1:23.46" ; null -> "--:--.--" */
export function fmtLap(ms, digits = 2) {
  if (ms == null || !isFinite(ms)) return '--:--.--';
  const neg = ms < 0;
  ms = Math.abs(ms);
  const min = Math.floor(ms / 60000);
  const sec = (ms % 60000) / 1000;
  const s = sec.toFixed(digits).padStart(digits + 3, '0');
  return `${neg ? '-' : ''}${min}:${s}`;
}

/** Écart signé, ex. "+0.42" / "-1.07" */
export function fmtDelta(ms) {
  if (ms == null || !isFinite(ms)) return '';
  return `${ms >= 0 ? '+' : '-'}${(Math.abs(ms) / 1000).toFixed(2)}`;
}

/** Durée courte : "12 s", "3 min 05 s" */
export function fmtDuration(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function fmtClock(t) {
  if (t == null) return '';
  return new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
