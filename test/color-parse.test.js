import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRgbCell, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from '../public/shared/color-parse.js';

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

test('hexToRgb accepts hash, 6-digit, and 3-digit values', () => {
  assert.deepEqual(hexToRgb('#1155CC'), { r: 17, g: 85, b: 204 });
  assert.deepEqual(hexToRgb('1155CC'), { r: 17, g: 85, b: 204 });
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.equal(hexToRgb(''), null);
  assert.equal(hexToRgb('#12'), null);
});

test('rgbToHsv and hsvToRgb round-trip primary colors', () => {
  for (const hex of ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF', '#000000', '#FE6220']) {
    const rgb = hexToRgb(hex);
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
    assert.equal(rgbToHex(back.r, back.g, back.b), hex);
  }
});

test('rgbToHsv reports expected hue for primaries', () => {
  assert.equal(Math.round(rgbToHsv(255, 0, 0).h), 0);
  assert.equal(Math.round(rgbToHsv(0, 255, 0).h), 120);
  assert.equal(Math.round(rgbToHsv(0, 0, 255).h), 240);
  assert.equal(rgbToHsv(0, 0, 0).v, 0);
  assert.equal(rgbToHsv(255, 255, 255).s, 0);
});
