import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCellForEditor,
  formatCellForSheet,
  validateAndFormatChanges,
  DEFAULT_ICON,
} from '../public/shared/sheet-format.js';

const EDITOR_COLUMNS = {
  BPM: { type: 'number', step: 0.1 },
  Cue: { type: 'icon', true: '✅', false: '✖' },
  RGB_1: { type: 'color' },
};

const HEADERS = ['Song Title', 'BPM', 'Cue', 'RGB_1'];

test('parseCellForEditor and formatCellForSheet round-trip BPM', () => {
  const cfg = EDITOR_COLUMNS.BPM;
  assert.equal(parseCellForEditor('95.5', cfg), '95.5');
  assert.equal(formatCellForSheet('105', cfg), '105');
});

test('parseCellForEditor and formatCellForSheet round-trip icon', () => {
  const cfg = EDITOR_COLUMNS.Cue;
  assert.equal(parseCellForEditor('✅', cfg), true);
  assert.equal(parseCellForEditor('✖', cfg), false);
  assert.equal(formatCellForSheet(true, cfg), '✅');
  assert.equal(formatCellForSheet(false, cfg), '✖');
});

test('parseCellForEditor and formatCellForSheet round-trip color', () => {
  const cfg = EDITOR_COLUMNS.RGB_1;
  assert.equal(parseCellForEditor('17,85,204', cfg), '#1155CC');
  assert.equal(parseCellForEditor('', cfg), null);
  assert.equal(formatCellForSheet('#1155CC', cfg), '17,85,204');
  assert.equal(formatCellForSheet('', cfg), '');
});

test('validateAndFormatChanges clears color to empty string', () => {
  const formatted = validateAndFormatChanges({ RGB_1: '' }, EDITOR_COLUMNS, HEADERS);
  assert.equal(formatted.RGB_1, '');
});

test('validateAndFormatChanges formats only provided columns', () => {
  const formatted = validateAndFormatChanges(
    { BPM: '128', Cue: true, RGB_1: '#FF0000' },
    EDITOR_COLUMNS,
    HEADERS
  );
  assert.deepEqual(formatted, {
    BPM: '128',
    Cue: '✅',
    RGB_1: '255,0,0',
  });
});

test('validateAndFormatChanges rejects unknown columns', () => {
  assert.throws(
    () => validateAndFormatChanges({ Unknown: 'x' }, EDITOR_COLUMNS, HEADERS),
    /unknown column/
  );
});

test('validateAndFormatChanges rejects invalid BPM', () => {
  assert.throws(
    () => validateAndFormatChanges({ BPM: 'nope' }, EDITOR_COLUMNS, HEADERS),
    /BPM:/
  );
});

test('text columns pass through unchanged', () => {
  const formatted = validateAndFormatChanges(
    { 'Song Title': 'Hello' },
    EDITOR_COLUMNS,
    HEADERS
  );
  assert.equal(formatted['Song Title'], 'Hello');
});

test('icon defaults use check and cross marks', () => {
  assert.equal(formatCellForSheet(true, { type: 'icon' }), DEFAULT_ICON.true);
  assert.equal(formatCellForSheet(false, { type: 'icon' }), DEFAULT_ICON.false);
});
