import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImageCell, formatImageCellForSheet } from '../public/shared/image-parse.js';
import {
  applyFormulaOverlay,
  collectImageColumns,
  partitionChangesByInputOption,
} from '../src/sheets/image-columns.js';

test('parseImageCell reads IMAGE formulas and bare URLs', () => {
  const formula = parseImageCell(
    '=IMAGE("https://raw.githubusercontent.com/org/repo/main/art.png", 1)',
  );
  assert.equal(formula?.url, 'https://raw.githubusercontent.com/org/repo/main/art.png');
  assert.match(formula.formula, /^=IMAGE/);

  const url = parseImageCell('https://example.com/a.png');
  assert.equal(url?.url, 'https://example.com/a.png');
  assert.equal(url.formula, null);

  assert.equal(parseImageCell(''), null);
  assert.equal(parseImageCell('not a url'), null);
});

test('formatImageCellForSheet wraps URLs as IMAGE formulas', () => {
  assert.equal(formatImageCellForSheet(''), '');
  assert.equal(
    formatImageCellForSheet('https://example.com/a.png'),
    '=IMAGE("https://example.com/a.png", 1)',
  );
  assert.equal(
    formatImageCellForSheet('=IMAGE("https://example.com/a.png", 2)'),
    '=IMAGE("https://example.com/a.png", 1)',
  );
});

test('applyFormulaOverlay fills blank cells from column values', () => {
  const rows = [
    { rowId: '6', data: { ART: '' } },
    { rowId: '7', data: { ART: 'already' } },
  ];
  const values = [];
  values[5] = ['=IMAGE("https://example.com/a.png", 1)'];
  values[6] = ['=IMAGE("https://example.com/b.png", 1)'];
  const filled = applyFormulaOverlay(rows, 'ART', values);
  assert.equal(filled, 1);
  assert.match(rows[0].data.ART, /example.com\/a/);
  assert.equal(rows[1].data.ART, 'already');
});

test('collectImageColumns reads editorColumns and view fields', () => {
  const cols = collectImageColumns({
    sheets: { editorColumns: { ART: { type: 'image' }, BPM: { type: 'number' } } },
    views: {
      admin: { fields: [{ column: 'PREVIZ-A', type: 'image' }] },
      visuals: { fields: [{ column: 'RGB_1', type: 'color' }] },
    },
  });
  assert.deepEqual(cols.sort(), ['ART', 'PREVIZ-A']);
});

test('partitionChangesByInputOption sends IMAGE formulas as USER_ENTERED', () => {
  const { raw, userEntered } = partitionChangesByInputOption(
    {
      BPM: '120',
      ART: '=IMAGE("https://example.com/a.png", 1)',
    },
    { ART: { type: 'image' }, BPM: { type: 'number' } },
  );
  assert.deepEqual(raw, { BPM: '120' });
  assert.deepEqual(userEntered, { ART: '=IMAGE("https://example.com/a.png", 1)' });
});
