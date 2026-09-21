import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rgbToLiveDisplay,
  slotForColumn,
  DEFAULT_LIVE_COLOR_COLUMNS,
  liveOverlayVisible,
  liveBusMeta,
  colorFieldVisible,
  liveStripColumns,
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
  assert.equal(liveOverlayVisible({
    enabled: true,
    staticColors: { accent: { r: 9, g: 8, b: 7 } },
  }, 'accent'), true);
});

test('liveBusMeta distinguishes live, stale, and empty buses', () => {
  const color = rgbToLiveDisplay({ r: 10, g: 20, b: 30 });
  assert.equal(liveBusMeta(color, true), '10, 20, 30');
  assert.equal(liveBusMeta(color, false), 'Stale 10, 20, 30');
  assert.equal(liveBusMeta(null, false), 'No signal');
  assert.equal(liveBusMeta(null, true), 'No data');
});

test('live overlay markup splits NOW into Look and FX', () => {
  const overlay = readFileSync(fileURLToPath(new URL('../public/shared/live-color-overlay.js', import.meta.url)), 'utf8');
  const render = readFileSync(fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)), 'utf8');
  assert.match(overlay, /kicker\.textContent = 'Now'/);
  assert.match(overlay, /renderLiveBus\('look', 'Look'\)/);
  assert.match(overlay, /renderLiveBus\('fx', 'FX'\)/);
  assert.match(render, /sheetKicker\.textContent = 'Sheet'/);
  assert.match(css, /\.color-live-split/);
  assert.match(css, /\.admin-dashboard-look \.field-color:not\(\.field-color--empty\) \.color-sheet-kicker/);
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

test('liveStripColumns keeps Main / Secondary / Accent and drops duplicate slots', () => {
  assert.deepEqual(liveStripColumns(), [
    { slot: 'main', column: 'RGB_1', label: 'Main' },
    { slot: 'secondary', column: 'RGB_2', label: 'Secondary' },
    { slot: 'accent', column: 'RGB_3', label: 'Accent' },
  ]);
  assert.deepEqual(liveStripColumns({ RGB_3: 'accent', Extra: 'main', RGB_1: 'main' }), [
    { slot: 'main', column: 'Extra', label: 'Main' },
    { slot: 'accent', column: 'RGB_3', label: 'Accent' },
  ]);
  assert.deepEqual(liveStripColumns({}), []);
  assert.deepEqual(liveStripColumns(null), liveStripColumns());
});

test('no-match mounts a fixed desk strip and leaves the clip grid to fill', () => {
  const render = readFileSync(fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)), 'utf8');
  const css = readFileSync(fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)), 'utf8');
  assert.match(render, /renderDeskColorStrip\(liveColorColumns\)/);
  assert.match(css, /\.desk-color-strip\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(css, /\.desk-color-strip\[hidden\][\s\S]*display:\s*none\s*!important/);
  assert.match(css, /body\.layout-operator \.playing-clips-strip\s*\{[^}]*flex:\s*1 1 auto/);
  assert.match(css, /body\.layout-operator \.desk-color-strip\s*\{[^}]*flex:\s*0 0 auto/);
});
