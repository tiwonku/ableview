import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setlistEditFields, setlistEditFieldsForHeaders } from '../src/setlist/edit-fields.js';

const config = {
  sheets: {
    matchColumn: 'Song Title',
    aliasColumn: 'Aliases',
    editorColumns: {
      BPM: { type: 'number', step: 0.1 },
      Cue: { type: 'icon', true: '✅', false: '✖' },
      RGB_1: { type: 'color' },
      ART: { type: 'image' },
    },
  },
  views: {
    band: {
      fields: [
        { column: 'Key' },
        { column: 'Key', type: 'camelot', label: 'Harmony' },
        { source: 'tempo', label: 'Tempo' },
      ],
    },
    visuals: {
      fields: [
        { column: 'ART', label: 'Album Art', type: 'image' },
        { column: 'RGB_1', label: 'Color 1', type: 'color' },
        { column: 'Viz Notes', display: 'note' },
      ],
    },
    admin: { title: 'Admin', system: true, fields: [{ column: 'Rare' }] },
  },
};

test('setlist edit fields keep show columns and skip archival and system views', () => {
  const fields = setlistEditFields(config);
  assert.deepEqual(fields.map((field) => field.column), [
    'Song Title',
    'Aliases',
    'Key',
    'BPM',
    'ART',
    'RGB_1',
    'Viz Notes',
    'Cue',
  ]);
  assert.equal(fields.find((field) => field.column === 'ART').label, 'Album Art');
  assert.equal(fields.find((field) => field.column === 'RGB_1').label, 'Color 1');
  assert.equal(fields.find((field) => field.column === 'Viz Notes').multiline, true);
  assert.equal(fields.find((field) => field.column === 'BPM').multiline, false);
});

test('header filter drops columns the sheet does not have', () => {
  const fields = setlistEditFieldsForHeaders(config, ['Song Title', 'Key', 'Viz Notes']);
  assert.deepEqual(fields.map((field) => field.column), ['Song Title', 'Key', 'Viz Notes']);
});
