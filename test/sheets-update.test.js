import { test } from 'node:test';
import assert from 'node:assert/strict';
import { columnIndexToLetter } from '../src/sheets/column-letter.js';
import {
  buildRowUpdateRanges,
  patchSnapshotRow,
} from '../src/sheets/update-row.js';

test('columnIndexToLetter maps indices to A1 letters', () => {
  assert.equal(columnIndexToLetter(0), 'A');
  assert.equal(columnIndexToLetter(25), 'Z');
  assert.equal(columnIndexToLetter(26), 'AA');
});

test('buildRowUpdateRanges builds per-cell update ranges', () => {
  const data = buildRowUpdateRanges({
    worksheet: 'MASTER_v1.1',
    headers: ['Song Title', 'BPM', 'Cue'],
    rowId: '12',
    changes: { BPM: '105', Cue: '✅' },
  });

  assert.equal(data.length, 2);
  assert.deepEqual(data[0], {
    range: "'MASTER_v1.1'!B12",
    values: [['105']],
  });
  assert.deepEqual(data[1], {
    range: "'MASTER_v1.1'!C12",
    values: [['✅']],
  });
});

test('patchSnapshotRow updates in-memory row data', () => {
  const snapshot = {
    rows: [{ rowId: '12', data: { BPM: '95', Cue: '✖' } }],
  };

  patchSnapshotRow(snapshot, '12', { BPM: '105', Cue: '✅' });
  assert.equal(snapshot.rows[0].data.BPM, '105');
  assert.equal(snapshot.rows[0].data.Cue, '✅');
});

test('patchSnapshotRow throws when row is missing', () => {
  const snapshot = { rows: [] };
  assert.throws(() => patchSnapshotRow(snapshot, '99', { BPM: '100' }), /row not found/);
});
