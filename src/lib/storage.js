// Sauvegarde locale des circuits (navigateur) + import / export JSON.
// En V2, ces fonctions pourront être branchées sur la base Supabase.

const KEY = 'solex.circuits.v1';
const ACTIVE = 'solex.activeCircuit.v1';

export function loadCircuits() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(isCircuit) : [];
  } catch {
    return [];
  }
}

export function saveCircuits(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function loadActiveId() {
  try { return localStorage.getItem(ACTIVE); } catch { return null; }
}

export function saveActiveId(id) {
  try { localStorage.setItem(ACTIVE, id); } catch { /* stockage indisponible */ }
}

const SETTINGS = 'solex.settings.v1';
const THEME = 'solex.theme.v1';

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS)) || {}; } catch { return {}; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}

export function loadTheme() {
  try { return localStorage.getItem(THEME) || 'dark'; } catch { return 'dark'; }
}

export function saveTheme(t) {
  try { localStorage.setItem(THEME, t); } catch { /* stockage indisponible */ }
}

/** Export des tours au format CSV (séparateur « ; » et virgule décimale pour Excel en français). */
export function exportLapsCsv(laps, circuitName, nSectors) {
  const sec = (ms) => (ms == null ? '' : (ms / 1000).toFixed(3).replace('.', ','));
  const header = ['Tour', 'Heure de début', 'Temps (s)', ...Array.from({ length: nSectors }, (_, i) => `S${i + 1} (s)`), 'Stand'];
  const rows = laps.map((l) => [
    l.number,
    new Date(l.start).toLocaleTimeString('fr-FR'),
    sec(l.time),
    ...Array.from({ length: nSectors }, (_, i) => sec(l.sectors[i])),
    l.pit ? 'oui' : '',
  ]);
  const csv = '﻿' + [header, ...rows].map((r) => r.join(';')).join('\r\n');
  const date = new Date().toISOString().slice(0, 10);
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `tours-${slug(circuitName)}-${date}.csv`);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCircuit(circuit) {
  download(new Blob([JSON.stringify(circuit, null, 2)], { type: 'application/json' }), `${slug(circuit.name)}.circuit.json`);
}

export async function importCircuitFile(file) {
  const data = JSON.parse(await file.text());
  if (!isCircuit(data)) throw new Error('Fichier de circuit invalide');
  return { ...data, id: 'c' + Date.now().toString(36), updatedAt: Date.now() };
}

function isCircuit(c) {
  return c && typeof c === 'object' && typeof c.name === 'string' && Array.isArray(c.track);
}

function slug(s) {
  return (s || 'circuit').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}
