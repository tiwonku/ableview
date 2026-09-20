import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFieldDisplay,
  groupFieldsForLayout,
  resolveFieldsLayoutMode,
  getFieldValue,
  fieldLabel,
  formatTempoFieldValue,
  isLiveField,
  isCamelotField,
} from '../public/shared/field-display.js';

test('resolveFieldDisplay respects explicit display', () => {
  assert.equal(resolveFieldDisplay({ column: 'X', display: 'token' }, 'long value here'), 'token');
  assert.equal(resolveFieldDisplay({ column: 'X', display: 'note' }, 'short'), 'note');
});

test('resolveFieldDisplay infers token from short values', () => {
  assert.equal(resolveFieldDisplay({ column: 'Key' }, 'Gm'), 'token');
  assert.equal(resolveFieldDisplay({ column: 'BPM' }, '93'), 'token');
});

test('resolveFieldDisplay infers note from column names', () => {
  assert.equal(resolveFieldDisplay({ column: 'Viz Notes' }, ''), 'note');
  assert.equal(resolveFieldDisplay({ column: 'CS Panels' }, null), 'note');
});

test('resolveFieldDisplay infers text for medium values', () => {
  assert.equal(resolveFieldDisplay({ column: 'Video World' }, 'Textures - L4'), 'text');
  assert.equal(resolveFieldDisplay({ column: 'Ghost Cloud' }, 'On - slow'), 'text');
});

test('resolveFieldsLayoutMode uses hero for small non-color views', () => {
  assert.equal(
    resolveFieldsLayoutMode([
      { column: 'Key' },
      { column: 'BPM' },
      { column: 'Key', type: 'camelot', label: 'Harmony' },
    ]),
    'hero',
  );
});

test('resolveFieldsLayoutMode uses strip for color or many fields', () => {
  assert.equal(
    resolveFieldsLayoutMode([
      { column: 'Video World' },
      { column: 'RGB_1', type: 'color' },
    ]),
    'strip',
  );
  assert.equal(
    resolveFieldsLayoutMode([
      { column: 'A' },
      { column: 'B' },
      { column: 'C' },
      { column: 'D' },
      { column: 'E' },
    ]),
    'strip',
  );
});

test('resolveFieldDisplay treats empty notch as text in strip layout', () => {
  assert.equal(resolveFieldDisplay({ column: 'Notch' }, '', { layout: 'strip' }), 'text');
  assert.equal(resolveFieldDisplay({ column: 'Notch' }, '', { layout: 'hero' }), 'token');
});

test('groupFieldsForLayout groups colors and caps row width', () => {
  const fields = [
    { column: 'A' },
    { column: 'B' },
    { column: 'C' },
    { column: 'D' },
    { column: 'RGB_1', type: 'color' },
    { column: 'RGB_2', type: 'color' },
    { column: 'Viz Notes' },
  ];
  const payload = {
    row: { A: '1', B: '2', C: '3', D: '4', 'Viz Notes': 'hello' },
  };
  const rows = groupFieldsForLayout(fields, payload);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].type, 'row');
  assert.equal(rows[0].items.length, 3);
  assert.equal(rows[1].type, 'row');
  assert.equal(rows[1].items.length, 1);
  assert.equal(rows[2].type, 'colors');
  assert.equal(rows[2].fields.length, 2);
  assert.equal(rows[3].type, 'note');
});

test('groupFieldsForLayout keeps image fields on their own row', () => {
  const rows = groupFieldsForLayout(
    [
      { column: 'ENERGY' },
      { column: 'ART', type: 'image' },
      { column: 'VIBE TAGS' },
    ],
    { row: { ENERGY: '2. Groove', ART: '=IMAGE("https://example.com/a.png", 1)' } },
  );
  assert.equal(rows[0].type, 'row');
  assert.equal(rows[1].type, 'image');
  assert.equal(rows[1].field.column, 'ART');
});

test('getFieldValue reads live tempo from CuePayload', () => {
  const field = { source: 'tempo', label: 'Tempo' };
  assert.equal(getFieldValue(field, { tempo: 128 }), '128');
  assert.equal(getFieldValue(field, { tempo: 90.5 }), '90.5');
  assert.equal(getFieldValue(field, { tempo: null }), null);
  assert.equal(getFieldValue(field, {}), null);
  // Sheet BPM must not win over live source
  assert.equal(getFieldValue(field, { tempo: 100, row: { BPM: '128' } }), '100');
});

test('getFieldValue still reads sheet columns', () => {
  assert.equal(getFieldValue({ column: 'BPM' }, { row: { BPM: '128' }, tempo: 100 }), '128');
});

test('getFieldValue ignores lastMatched.row when current row is absent (NFR-7)', () => {
  assert.equal(getFieldValue({ column: 'BPM' }, {
    match: { matched: false },
    lastMatched: { title: 'Yellow Bird', rowId: '87', row: { BPM: '87' } },
  }), null);
});

test('formatTempoFieldValue and fieldLabel helpers', () => {
  assert.equal(formatTempoFieldValue(128), '128');
  assert.equal(formatTempoFieldValue(128.25), '128.3');
  assert.equal(fieldLabel({ source: 'tempo' }), 'Tempo');
  assert.equal(fieldLabel({ source: 'tempo', label: 'Live BPM' }), 'Live BPM');
  assert.equal(isLiveField({ source: 'tempo' }), true);
  assert.equal(isLiveField({ column: 'BPM' }), false);
});

test('resolveFieldDisplay defaults live tempo to token', () => {
  assert.equal(resolveFieldDisplay({ source: 'tempo' }, '128'), 'token');
});

test('camelot fields stay on the hero token row', () => {
  assert.equal(isCamelotField({ column: 'Key', type: 'camelot' }), true);
  assert.equal(resolveFieldDisplay({ column: 'Key', type: 'camelot' }, 'Gm'), 'token');
  const rows = groupFieldsForLayout(
    [
      { column: 'Key', display: 'token' },
      { column: 'Key', type: 'camelot', label: 'Harmony' },
      { source: 'tempo', label: 'Tempo' },
    ],
    { row: { Key: 'Gm' }, tempo: 105 },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'row');
  assert.deepEqual(rows[0].items.map((item) => item.field.type ?? item.field.source), [
    undefined,
    'camelot',
    'tempo',
  ]);
});
