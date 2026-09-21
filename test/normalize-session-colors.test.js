import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOLD_GAP_MS,
  normalizeLines,
  paletteKey,
} from '../scripts/normalize-session-colors.mjs';

function at(ms, extra = {}) {
  return {
    timestamp: '20:00:00:00',
    timestampSource: 'clock',
    loggedAt: new Date(ms).toISOString(),
    event: 'live_color',
    reason: 'settled',
    universe: 191,
    clipName: 'clip',
    rowId: '1',
    simulated: false,
    sessionName: 'test',
    colors: {
      main: { r: 0, g: 0, b: 255 },
      secondary: { r: 0, g: 0, b: 255 },
      accent: { r: 0, g: 0, b: 255 },
    },
    ...extra,
  };
}

function line(record) {
  return JSON.stringify(record);
}

function colors(r, g, b) {
  const slot = { r, g, b };
  return { main: { ...slot }, secondary: { ...slot }, accent: { ...slot } };
}

test('paletteKey quantizes channels to 16', () => {
  assert.equal(paletteKey(colors(0, 0, 255)), paletteKey(colors(4, 0, 250)));
  assert.notEqual(paletteKey(colors(0, 0, 255)), paletteKey(colors(255, 0, 0)));
});

test('a chase shorter than the hold gap collapses to one move and one hold', () => {
  const t0 = Date.parse('2026-09-19T02:00:00.000Z');
  const lines = [
    line(at(t0, { reason: 'motion' })),
    line({ event: 'moment', kind: 'dope', who: 'nik', note: null, loggedAt: new Date(t0 + 100).toISOString() }),
    line(at(t0 + 400, { reason: 'motion', colors: colors(10, 0, 255) })),
    line(at(t0 + 800, { colors: colors(0, 0, 255) })),
    line(at(t0 + 800 + HOLD_GAP_MS, { colors: colors(255, 0, 0) })),
  ];

  const raw = normalizeLines(lines);
  assert.equal(raw[1], lines[1]);
  const out = raw.map((row) => JSON.parse(row));
  assert.deepEqual(out.map((row) => row.event === 'live_color' ? row.phase : row.event), [
    'move',
    'moment',
    'hold',
    'hold',
  ]);
  assert.equal(out[0].colors, undefined);
  assert.equal(out[0].review, undefined);
  assert.equal(out[0].loggedAt, new Date(t0).toISOString());
  assert.deepEqual(out[2].colors.main, { r: 0, g: 0, b: 255 });
  assert.equal(out[1].who, 'nik');
});

test('a single settled sample is a hold with no move', () => {
  const t0 = Date.parse('2026-09-19T02:00:00.000Z');
  const out = normalizeLines([
    line(at(t0)),
    line(at(t0 + HOLD_GAP_MS, { colors: colors(255, 0, 0) })),
  ]).map((row) => JSON.parse(row));

  assert.deepEqual(out.map((row) => row.phase), ['hold', 'hold']);
  assert.equal(out.some((row) => row.phase === 'move'), false);
});

test('a gap under 3 seconds stays inside the chase', () => {
  const t0 = Date.parse('2026-09-19T02:00:00.000Z');
  const out = normalizeLines([
    line(at(t0)),
    line(at(t0 + HOLD_GAP_MS - 1)),
    line(at(t0 + HOLD_GAP_MS - 1 + HOLD_GAP_MS)),
  ]).map((row) => JSON.parse(row));

  assert.deepEqual(out.map((row) => row.phase), ['move', 'hold', 'hold']);
  assert.equal(out[0].loggedAt, new Date(t0).toISOString());
  assert.equal(out[1].loggedAt, new Date(t0 + HOLD_GAP_MS - 1).toISOString());
});

test('a chase that reaches end of file is a move without a closing hold', () => {
  const t0 = Date.parse('2026-09-19T02:00:00.000Z');
  const out = normalizeLines([
    line(at(t0)),
    line(at(t0 + HOLD_GAP_MS)),
    line(at(t0 + HOLD_GAP_MS + 400, { reason: 'motion' })),
    line(at(t0 + HOLD_GAP_MS + 800, { reason: 'motion' })),
  ]).map((row) => JSON.parse(row));

  assert.deepEqual(out.map((row) => row.phase), ['hold', 'move']);
});

test('review is set only when the hold before a chase and the hold after it differ', () => {
  const t0 = Date.parse('2026-09-19T02:00:00.000Z');
  const blue = colors(0, 0, 255);
  const red = colors(255, 0, 0);
  const lines = [
    line(at(t0, { colors: blue })),
    line(at(t0 + 10_000, { reason: 'motion', colors: blue })),
    line(at(t0 + 10_400, { colors: blue })),
    line(at(t0 + 20_000, { reason: 'motion', colors: red })),
    line(at(t0 + 20_400, { colors: red })),
    line(at(t0 + 30_000, { colors: red })),
  ];
  const out = normalizeLines(lines).map((row) => JSON.parse(row));
  const moves = out.filter((row) => row.phase === 'move');
  assert.equal(moves.length, 2);
  assert.equal(moves[0].review, undefined);
  assert.equal(moves[1].review, true);
  assert.equal(out[0].phase, 'hold');
  assert.equal(out[0].review, undefined);
});
