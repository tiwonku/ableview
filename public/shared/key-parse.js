// Sheet Key cells: tonic A–G, optional b/#, optional m (minor; default major).

const KEY_PATTERN = /^([A-G])([b#])?(m)?$/i;

const NATURAL_NAMES = Object.freeze(['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']);
const SHARP_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
const FLAT_NAMES = Object.freeze(['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']);

const PITCH_CLASS = Object.freeze({
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
});

export function pitchClassName(pc, prefer = 'natural') {
  const n = ((Number(pc) % 12) + 12) % 12;
  const table = prefer === 'sharp' ? SHARP_NAMES : prefer === 'flat' ? FLAT_NAMES : NATURAL_NAMES;
  return table[n];
}

/** @returns {{ pc: number, mode: 'major'|'minor', letter: string, accent: string, prefer: 'sharp'|'flat'|'natural' } | null} */
export function parseKey(raw) {
  if (raw == null) return null;
  const match = String(raw).trim().match(KEY_PATTERN);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accent = match[2] ?? '';
  const pc = PITCH_CLASS[`${letter}${accent}`];
  if (pc == null) return null;

  return {
    pc,
    mode: match[3] ? 'minor' : 'major',
    letter,
    accent,
    prefer: accent === 'b' ? 'flat' : accent === '#' ? 'sharp' : 'natural',
  };
}

export function formatKey(pc, mode, prefer = 'natural') {
  const name = pitchClassName(pc, prefer);
  return mode === 'minor' ? `${name}m` : name;
}
