import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetGrid, getMatchValues } from '../src/sheets/parse.js';

// Mimics PL SONG SHEET: metadata rows 1–3, headers on row 4, data from row 5.
const PL_SONG_SHEET_GRID = [
  ['last edited - 7/30/2024'],
  [],
  ['', '', '', 'grey', 'orange'],
  ['Song Title', 'Cue', 'Pillar', 'ALS Folder', 'BPM', 'Key'],
  ['A Million Tomorrows', 'x', '', 'Abm_75bpm_AMillionTomorrows_', '90.2', 'Ebm / Gb'],
  ['After Midnight', 'x', '', 'Abm_75bpm_AfterMidnight_', '95', 'Dm / F'],
  [],
];

test('headerRow 1 uses first row as headers (default)', () => {
  const grid = [
    ['Clip Name', 'BPM'],
    ['Song A', '128'],
  ];
  const { headers, rows } = parseSheetGrid(grid, { headerRow: 1 });
  assert.deepEqual(headers, ['Clip Name', 'BPM']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rowId, '2');
  assert.equal(rows[0].data['Clip Name'], 'Song A');
});

test('headerRow 4 skips preamble rows (PL SONG SHEET layout)', () => {
  const { headers, rows } = parseSheetGrid(PL_SONG_SHEET_GRID, { headerRow: 4 });

  assert.deepEqual(headers, ['Song Title', 'Cue', 'Pillar', 'ALS Folder', 'BPM', 'Key']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowId, '5');
  assert.equal(rows[0].data['Song Title'], 'A Million Tomorrows');
  assert.equal(rows[0].data.BPM, '90.2');
  assert.equal(rows[1].rowId, '6');
  assert.equal(rows[1].data['Song Title'], 'After Midnight');
});

test('blank data rows are skipped', () => {
  const { rows } = parseSheetGrid(PL_SONG_SHEET_GRID, { headerRow: 4 });
  assert.equal(rows.length, 2, 'trailing empty row 7 should be ignored');
});

test('getMatchValues returns trimmed non-empty match column values', () => {
  const { rows } = parseSheetGrid(PL_SONG_SHEET_GRID, { headerRow: 4 });
  assert.deepEqual(getMatchValues(rows, 'Song Title'), [
    'A Million Tomorrows',
    'After Midnight',
  ]);
});

test('headerRow outside fetched range throws', () => {
  assert.throws(
    () => parseSheetGrid([['only one row']], { headerRow: 4 }),
    /outside the fetched range/
  );
});

test('unnamed header columns are omitted from row data', () => {
  const grid = [
    [],
    [],
    [],
    ['Name', '', 'BPM'],
    ['Song A', 'ignored', '128'],
  ];
  const { rows } = parseSheetGrid(grid, { headerRow: 4 });
  assert.deepEqual(Object.keys(rows[0].data), ['Name', 'BPM']);
});
