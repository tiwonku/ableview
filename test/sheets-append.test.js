import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppendRowValues,
  parseAppendedRowId,
  appendSnapshotRow,
} from '../src/sheets/append-row.js';

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

test('parseAppendedRowId extracts row number from multi-column range', () => {
  assert.equal(parseAppendedRowId("'MASTER_v1.1'!A42:Z42"), '42');
});

test('parseAppendedRowId extracts row number from single cell range', () => {
  assert.equal(parseAppendedRowId('Sheet1!B15'), '15');
});

test('parseAppendedRowId throws when range is missing or unparseable', () => {
  assert.throws(() => parseAppendedRowId(null), /missing updatedRange/);
  assert.throws(() => parseAppendedRowId('invalid'), /could not parse row id/);
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
