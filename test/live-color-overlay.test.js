import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLiveDisplay, slotForColumn, DEFAULT_LIVE_COLOR_COLUMNS } from '../public/shared/live-color-overlay.js';

test('slotForColumn maps RGB columns onto Jake slots', () => {
  assert.equal(slotForColumn('RGB_1'), 'main');
  assert.equal(slotForColumn('RGB_2'), 'secondary');
  assert.equal(slotForColumn('RGB_3'), 'accent');
  assert.equal(slotForColumn('RGB_1', { RGB_1: 'accent' }), 'accent');
  assert.equal(slotForColumn('Notch'), null);
});

test('rgbToLiveDisplay formats 8-bit RGB like sheet colors', () => {
  const color = rgbToLiveDisplay({ r: 255, g: 128, b: 0 });
  assert.equal(color.css, 'rgb(255, 128, 0)');
  assert.equal(color.hex, '#FF8000');
  assert.equal(color.rgbText, '255, 128, 0');
  assert.equal(rgbToLiveDisplay(null), null);
});

test('DEFAULT_LIVE_COLOR_COLUMNS covers the three sheet RGB columns', () => {
  assert.deepEqual(DEFAULT_LIVE_COLOR_COLUMNS, {
    RGB_1: 'main',
    RGB_2: 'secondary',
    RGB_3: 'accent',
  });
});
