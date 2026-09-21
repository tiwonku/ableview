import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbToLiveDisplay,
  slotForColumn,
  DEFAULT_LIVE_COLOR_COLUMNS,
  liveOverlayVisible,
  colorFieldVisible,
} from '../public/shared/live-color-overlay.js';

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

test('liveOverlayVisible requires enabled sACN and a known slot RGB', () => {
  assert.equal(liveOverlayVisible({ enabled: true, colors: { main: { r: 1, g: 2, b: 3 } } }, 'main'), true);
  assert.equal(liveOverlayVisible({ enabled: true, colors: { main: { r: 1, g: 2, b: 3 } } }, 'accent'), false);
  assert.equal(liveOverlayVisible({ enabled: false, colors: { main: { r: 1, g: 2, b: 3 } } }, 'main'), false);
  assert.equal(liveOverlayVisible({ enabled: true, colors: {} }, 'main'), false);
});

test('colorFieldVisible hides empty sheet color unless live or editing', () => {
  assert.equal(colorFieldVisible({}), false);
  assert.equal(colorFieldVisible({ sheetColor: true }), true);
  assert.equal(colorFieldVisible({ liveColor: true }), true);
  assert.equal(colorFieldVisible({ editing: true }), true);
});

test('empty color cards keep [hidden] above layout display:flex', () => {
  const css = readFileSync(fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)), 'utf8');
  assert.match(css, /\.field-color\[hidden\][\s\S]*display:\s*none\s*!important/);
});
