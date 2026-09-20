// Camelot wheel: 1–12 × A (minor) / B (major). Neighbors = relative + ±1.

import { formatKey, parseKey } from './key-parse.js';

function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function wrapCamelot(n) {
  return mod12(n - 1) + 1;
}

/** 1A = Ab minor (pc 8); 1B = B major (pc 11). +1 Camelot = +7 semitones. */
export function camelotNumber(pc, mode) {
  const base = mode === 'minor' ? 8 : 11;
  return mod12((pc - base) * 7) + 1;
}

export function camelotLetter(mode) {
  return mode === 'minor' ? 'A' : 'B';
}

export function formatCamelotCode(n, letter) {
  return `${n}${letter}`;
}

export function fromCamelot(n, letter) {
  const mode = letter === 'A' ? 'minor' : 'major';
  const base = mode === 'minor' ? 8 : 11;
  const pc = mod12(base + (Number(n) - 1) * 7);
  return { pc, mode, n: Number(n), letter };
}

export function neighborSlots(n, letter) {
  return {
    relative: { n, letter: letter === 'A' ? 'B' : 'A' },
    prev: { n: wrapCamelot(n - 1), letter },
    next: { n: wrapCamelot(n + 1), letter },
  };
}

function toEntry(slot, role, prefer) {
  const { pc, mode } = fromCamelot(slot.n, slot.letter);
  return {
    role,
    n: slot.n,
    letter: slot.letter,
    code: formatCamelotCode(slot.n, slot.letter),
    pc,
    mode,
    name: formatKey(pc, mode, prefer),
  };
}

export function formatHarmonyChip(entry) {
  if (!entry?.name || !entry?.code) return '';
  return `${entry.name} · ${entry.code}`;
}

/** Compatible slots for a parsed key, or null if the cell does not parse. */
export function harmonyFromRaw(raw) {
  const parsed = parseKey(raw);
  if (!parsed) return null;

  const n = camelotNumber(parsed.pc, parsed.mode);
  const letter = camelotLetter(parsed.mode);
  const prefer = parsed.prefer;
  const slots = neighborSlots(n, letter);

  return {
    current: {
      ...parsed,
      n,
      letter,
      code: formatCamelotCode(n, letter),
      name: formatKey(parsed.pc, parsed.mode, prefer),
    },
    neighbors: [
      toEntry(slots.relative, 'relative', prefer),
      toEntry(slots.prev, 'prev', prefer),
      toEntry(slots.next, 'next', prefer),
    ],
    prefer,
  };
}

export function slotRelation(n, letter, current) {
  if (!current) return null;
  if (n === current.n && letter === current.letter) return 'current';
  if (n === current.n && letter !== current.letter) return 'relative';
  if (letter === current.letter && n === wrapCamelot(current.n - 1)) return 'prev';
  if (letter === current.letter && n === wrapCamelot(current.n + 1)) return 'next';
  return null;
}

export function camelotWheelSlots(prefer = 'natural') {
  const slots = [];
  for (const letter of ['B', 'A']) {
    for (let n = 1; n <= 12; n += 1) {
      const { pc, mode } = fromCamelot(n, letter);
      slots.push({
        n,
        letter,
        code: formatCamelotCode(n, letter),
        pc,
        mode,
        name: formatKey(pc, mode, prefer),
        ring: letter === 'B' ? 'outer' : 'inner',
      });
    }
  }
  return slots;
}
