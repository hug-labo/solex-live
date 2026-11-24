// Alarme sonore générée (Web Audio) : pas de fichier à charger.
// Les navigateurs bloquent le son tant que l'utilisateur n'a pas interagi :
// on « déverrouille » le contexte audio au premier clic.

let ctx = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* pas d'audio disponible */ }
  return audioReady();
}

export function audioReady() {
  return !!ctx && ctx.state === 'running';
}

/** Un motif d'alarme deux tons, très audible dans le bruit. */
export function playAlarm() {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const tones = [
    [1760, 0.0], [1175, 0.18], [1760, 0.36], [1175, 0.54],
  ];
  for (const [freq, at] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + at);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + 0.17);
  }
}
