import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppendRowValues,
  buildExplicitRowRange,
  nextAppendRow,
  appendSnapshotRow,
  snapshotRowData,
} from '../src/sheets/append-row.js';

test('nextAppendRow returns row after last seen data row', () => {
  const rows = [
    { rowId: '6', data: {} },
    { rowId: '180', data: {} },
    { rowId: '184', data: {} },
  ];
  assert.equal(nextAppendRow({ rows, headerRow: 4 }), 185);
});

test('nextAppendRow skips header and gap when sheet has no data rows yet', () => {
  assert.equal(nextAppendRow({ rows: [], headerRow: 4 }), 6);
});

test('nextAppendRow rejects invalid headerRow', () => {
  assert.throws(() => nextAppendRow({ rows: [], headerRow: 0 }), /positive integer/);
});

test('buildExplicitRowRange targets a single row from column A', () => {
  assert.equal(
    buildExplicitRowRange('MASTER_v1.1', '185', ['Song Title', 'BPM', 'Cue']),
    "'MASTER_v1.1'!A185:C185"
  );
});

test('buildExplicitRowRange spans full header width', () => {
  const headers = Array.from({ length: 42 }, (_, i) => `Col${i}`);
  assert.equal(
    buildExplicitRowRange('Sheet', '10', headers),
    "'Sheet'!A10:AP10"
  );
});

test('buildExplicitRowRange escapes worksheet quotes', () => {
  assert.equal(
    buildExplicitRowRange("O'Brien", '12', ['A']),
    "'O''Brien'!A12:A12"
  );
});

test('buildAppendRowValues maps headers to row array with blanks for missing columns', () => {
  const values = buildAppendRowValues(
    ['Song Title', 'BPM', 'Cue'],
    { 'Song Title': 'New Song', BPM: '120' }
  );

  assert.deepEqual(values, ['New Song', '120', '']);
});

test('buildAppendRowValues preserves empty header slots', () => {
  const values = buildAppendRowValues(['Song Title', '', 'BPM'], { BPM: '95' });
  assert.deepEqual(values, ['', '', '95']);
});

test('snapshotRowData maps row values by header index not filtered index', () => {
  const data = snapshotRowData(
    ['Song Title', '', 'BPM'],
    ['New Song', 'ignored', '120']
  );

  assert.deepEqual(data, {
    'Song Title': 'New Song',
    BPM: '120',
  });
});

test('appendSnapshotRow adds row to snapshot', () => {
  const snapshot = {
    rows: [{ rowId: '10', data: { BPM: '95' } }],
  };

  appendSnapshotRow(snapshot, '11', { 'Song Title': 'New Song', BPM: '120' });

  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[1].rowId, '11');
  assert.equal(snapshot.rows[1].data['Song Title'], 'New Song');
});

test('appendSnapshotRow throws when row id already exists', () => {
  const snapshot = { rows: [{ rowId: '11', data: {} }] };
  assert.throws(
    () => appendSnapshotRow(snapshot, '11', { 'Song Title': 'Dup' }),
    /row already exists/
  );
});
