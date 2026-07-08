import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRgbCell } from '../public/shared/color-parse.js';

test('parseRgbCell parses comma-separated 0-255 values', () => {
  const color = parseRgbCell('109,158,235');
  assert.deepEqual(color, {
    r: 109,
    g: 158,
    b: 235,
    css: 'rgb(109, 158, 235)',
    hex: '#6D9EEB',
    rgbText: '109, 158, 235',
  });
});

test('parseRgbCell accepts spaced commas', () => {
  assert.equal(parseRgbCell('255, 229, 153').hex, '#FFE599');
});

test('parseRgbCell rejects invalid input', () => {
  assert.equal(parseRgbCell(''), null);
  assert.equal(parseRgbCell('109,158'), null);
  assert.equal(parseRgbCell('109,158,300'), null);
  assert.equal(parseRgbCell('not-a-color'), null);
  assert.equal(parseRgbCell(null), null);
});
