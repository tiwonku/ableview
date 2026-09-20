import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, formatKey, pitchClassName } from '../public/shared/key-parse.js';
import {
  camelotLetter,
  camelotNumber,
  camelotWheelSlots,
  formatCamelotCode,
  formatHarmonyChip,
  fromCamelot,
  harmonyFromRaw,
  neighborSlots,
  slotRelation,
  wrapCamelot,
} from '../public/shared/camelot.js';

test('parseKey accepts tonic, optional accent, optional m', () => {
  assert.deepEqual(parseKey('Gm'), {
    pc: 7, mode: 'minor', letter: 'G', accent: '', prefer: 'natural',
  });
  assert.deepEqual(parseKey('  ebm  '), {
    pc: 3, mode: 'minor', letter: 'E', accent: 'b', prefer: 'flat',
  });
  assert.deepEqual(parseKey('C#m'), {
    pc: 1, mode: 'minor', letter: 'C', accent: '#', prefer: 'sharp',
  });
  assert.deepEqual(parseKey('Bb'), {
    pc: 10, mode: 'major', letter: 'B', accent: 'b', prefer: 'flat',
  });
  assert.deepEqual(parseKey('D'), {
    pc: 2, mode: 'major', letter: 'D', accent: '', prefer: 'natural',
  });
  assert.deepEqual(parseKey('f#'), {
    pc: 6, mode: 'major', letter: 'F', accent: '#', prefer: 'sharp',
  });
});

test('parseKey rejects leftovers and empty cells', () => {
  assert.equal(parseKey(''), null);
  assert.equal(parseKey(null), null);
  assert.equal(parseKey('A minor'), null);
  assert.equal(parseKey('C#maj'), null);
  assert.equal(parseKey('8A'), null);
  assert.equal(parseKey('Gm7'), null);
});

test('formatKey keeps the source accidental preference', () => {
  assert.equal(formatKey(1, 'minor', 'sharp'), 'C#m');
  assert.equal(formatKey(1, 'minor', 'flat'), 'Dbm');
  assert.equal(formatKey(10, 'major', 'natural'), 'Bb');
  assert.equal(pitchClassName(8, 'sharp'), 'G#');
  assert.equal(pitchClassName(8, 'flat'), 'Ab');
});

test('camelotNumber maps representative sheet keys', () => {
  assert.equal(camelotNumber(7, 'minor'), 6);
  assert.equal(camelotLetter('minor'), 'A');
  assert.equal(formatCamelotCode(6, 'A'), '6A');
  assert.equal(camelotNumber(11, 'minor'), 10);
  assert.equal(camelotNumber(1, 'minor'), 12);
  assert.equal(camelotNumber(3, 'minor'), 2);
  assert.equal(camelotNumber(5, 'minor'), 4);
  assert.equal(camelotNumber(10, 'major'), 6);
  assert.equal(camelotNumber(2, 'major'), 10);
  assert.equal(camelotNumber(4, 'major'), 12);
});

test('fromCamelot round-trips every slot', () => {
  for (const letter of ['A', 'B']) {
    for (let n = 1; n <= 12; n += 1) {
      const { pc, mode } = fromCamelot(n, letter);
      assert.equal(camelotNumber(pc, mode), n);
      assert.equal(camelotLetter(mode), letter);
    }
  }
});

test('harmonyFromRaw(Gm) is 6A with relative and ±1', () => {
  const harmony = harmonyFromRaw('Gm');
  assert.equal(harmony.current.code, '6A');
  assert.equal(harmony.current.name, 'Gm');
  assert.deepEqual(
    harmony.neighbors.map((n) => formatHarmonyChip(n)),
    ['Bb · 6B', 'Cm · 5A', 'Dm · 7A'],
  );
  assert.deepEqual(harmony.neighbors.map((n) => n.role), ['relative', 'prev', 'next']);
});

test('harmonyFromRaw keeps sharp/flat spelling on neighbors', () => {
  const sharp = harmonyFromRaw('C#m');
  assert.equal(sharp.current.code, '12A');
  assert.deepEqual(
    sharp.neighbors.map((n) => formatHarmonyChip(n)),
    ['E · 12B', 'F#m · 11A', 'G#m · 1A'],
  );

  const flat = harmonyFromRaw('Ebm');
  assert.equal(flat.current.code, '2A');
  assert.deepEqual(
    flat.neighbors.map((n) => formatHarmonyChip(n)),
    ['Gb · 2B', 'Abm · 1A', 'Bbm · 3A'],
  );

  const bm = harmonyFromRaw('Bm');
  assert.equal(bm.current.code, '10A');
  assert.deepEqual(
    bm.neighbors.map((n) => formatHarmonyChip(n)),
    ['D · 10B', 'Em · 9A', 'F#m · 11A'],
  );
});

test('harmonyFromRaw returns null when Key does not parse', () => {
  assert.equal(harmonyFromRaw(''), null);
  assert.equal(harmonyFromRaw('A minor'), null);
});

test('neighborSlots wraps 1 and 12', () => {
  assert.deepEqual(neighborSlots(1, 'A'), {
    relative: { n: 1, letter: 'B' },
    prev: { n: 12, letter: 'A' },
    next: { n: 2, letter: 'A' },
  });
  assert.equal(wrapCamelot(0), 12);
  assert.equal(wrapCamelot(13), 1);
});

test('slotRelation and wheel slots mark current plus three neighbors', () => {
  const current = harmonyFromRaw('Gm').current;
  assert.equal(slotRelation(6, 'A', current), 'current');
  assert.equal(slotRelation(6, 'B', current), 'relative');
  assert.equal(slotRelation(5, 'A', current), 'prev');
  assert.equal(slotRelation(7, 'A', current), 'next');
  assert.equal(slotRelation(8, 'A', current), null);

  const slots = camelotWheelSlots('natural');
  assert.equal(slots.length, 24);
  assert.equal(slots.filter((s) => s.ring === 'outer').length, 12);
  assert.equal(slots.find((s) => s.code === '8B').name, 'C');
  assert.equal(slots.find((s) => s.code === '1A').name, 'Abm');
});
