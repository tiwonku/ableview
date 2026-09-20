import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCellForSheet } from '../public/shared/sheet-format.js';
import {
  flashableColorColumns,
  liveColorsToEditorChanges,
  canFlashLook,
  flashLookDisabledReason,
  isLiveColorMoving,
  buildFlashLookSlots,
  flashLookChangesForColumns,
  flashLookWarnings,
} from '../public/shared/flash-look.js';

const FIELDS = [
  { column: 'Lasers' },
  { column: 'RGB_1', label: 'Color 1', type: 'color' },
  { column: 'RGB_2', label: 'Color 2', type: 'color' },
  { column: 'RGB_3', label: 'Color 3', type: 'color' },
];

const LIVE = {
  enabled: true,
  live: true,
  colors: {
    main: { r: 255, g: 0, b: 80 },
    secondary: { r: 232, g: 156, b: 255 },
    accent: { r: 0, g: 120, b: 216 },
  },
};

test('flashableColorColumns keeps mapped color fields in view order', () => {
  assert.deepEqual(flashableColorColumns(FIELDS), ['RGB_1', 'RGB_2', 'RGB_3']);
  assert.deepEqual(
    flashableColorColumns([
      { column: 'Key' },
      { column: 'RGB_1', type: 'color' },
    ]),
    ['RGB_1'],
  );
  assert.deepEqual(flashableColorColumns([{ column: 'Key' }]), []);
});

test('liveColorsToEditorChanges prefers the static look over FX', () => {
  const mixed = {
    ...LIVE,
    colors: {
      main: { r: 1, g: 2, b: 3 },
      secondary: { r: 4, g: 5, b: 6 },
      accent: { r: 7, g: 8, b: 9 },
    },
    staticColors: LIVE.colors,
  };
  assert.deepEqual(liveColorsToEditorChanges(mixed), {
    RGB_1: '#FF0050',
    RGB_2: '#E89CFF',
    RGB_3: '#0078D8',
  });
});

test('liveColorsToEditorChanges writes hex for live slots only', () => {
  assert.deepEqual(liveColorsToEditorChanges(LIVE), {
    RGB_1: '#FF0050',
    RGB_2: '#E89CFF',
    RGB_3: '#0078D8',
  });
  assert.deepEqual(
    liveColorsToEditorChanges({ ...LIVE, live: false }),
    {},
  );
  assert.deepEqual(
    liveColorsToEditorChanges(
      { ...LIVE, colors: { ...LIVE.colors, accent: null } },
      undefined,
      { columns: ['RGB_3'] },
    ),
    {},
  );
});

test('flash look hex formats to spaced RGB for the sheet', () => {
  const changes = liveColorsToEditorChanges(LIVE, undefined, { columns: ['RGB_3'] });
  assert.equal(formatCellForSheet(changes.RGB_3, { type: 'color' }), '0, 120, 216');
});

test('canFlashLook requires live sACN and at least one RGB slot', () => {
  assert.equal(canFlashLook(LIVE, ['RGB_1', 'RGB_2', 'RGB_3']), true);
  assert.equal(canFlashLook({ ...LIVE, live: false }, ['RGB_1']), false);
  assert.equal(canFlashLook({ ...LIVE, enabled: false }, ['RGB_1']), false);
  assert.equal(canFlashLook({ ...LIVE, preview: true }, ['RGB_1']), false);
  assert.equal(canFlashLook(LIVE, []), false);
});

test('flashLookDisabledReason explains why the button is idle', () => {
  assert.match(flashLookDisabledReason(LIVE, ['RGB_1']), /Write GrandMA/);
  assert.match(flashLookDisabledReason({ ...LIVE, live: false }, ['RGB_1']), /No GrandMA signal/);
  assert.match(flashLookDisabledReason(LIVE, []), /No GrandMA color fields/);
});

test('isLiveColorMoving uses the sACN change delta', () => {
  const next = LIVE;
  const still = { live: true, colors: { ...LIVE.colors } };
  const chase = {
    live: true,
    colors: { ...LIVE.colors, main: { r: 255, g: 40, b: 80 } },
  };
  assert.equal(isLiveColorMoving(still, next), false);
  assert.equal(isLiveColorMoving(chase, next), true);
  assert.equal(isLiveColorMoving(null, next), false);
});

test('isLiveColorMoving ignores a parked FX/look profile offset', () => {
  const parked = {
    live: true,
    moving: false,
    colors: {
      main: { r: 0, g: 255, b: 0 },
      secondary: { r: 255, g: 0, b: 0 },
      accent: { r: 255, g: 204, b: 0 },
    },
    staticColors: {
      main: { r: 0, g: 255, b: 0 },
      secondary: { r: 255, g: 0, b: 0 },
      accent: { r: 255, g: 168, b: 0 },
    },
  };
  assert.equal(isLiveColorMoving(parked, parked), false);
});

test('buildFlashLookSlots snapshots sheet vs GrandMA and flags rainbow', () => {
  const slots = buildFlashLookSlots({
    fields: FIELDS,
    row: { RGB_1: '10, 20, 30', RGB_2: 'RAINBOW', RGB_3: '' },
    liveColors: LIVE,
  });
  assert.equal(slots.length, 3);
  assert.equal(slots[0].sheet.hex, '#0A141E');
  assert.equal(slots[0].live.hex, '#FF0050');
  assert.equal(slots[1].rainbow, true);
  assert.equal(slots[2].sheet, null);
  assert.equal(slots[2].canWrite, true);
});

test('flashLookChangesForColumns writes only requested live slots', () => {
  const slots = buildFlashLookSlots({ fields: FIELDS, row: {}, liveColors: LIVE });
  assert.deepEqual(flashLookChangesForColumns(slots, ['RGB_2']), { RGB_2: '#E89CFF' });
  assert.equal(Object.keys(flashLookChangesForColumns(slots, ['RGB_1', 'RGB_2', 'RGB_3'])).length, 3);
});

test('flashLookWarnings cover motion, rainbow, and missing slots', () => {
  const slots = buildFlashLookSlots({
    fields: FIELDS,
    row: { RGB_2: 'RAINBOW' },
    liveColors: { ...LIVE, colors: { ...LIVE.colors, accent: null } },
  });
  const warnings = flashLookWarnings(slots, { moving: true });
  assert.equal(warnings.length, 3);
  assert.match(warnings[0], /static look/);
  assert.match(warnings[1], /RAINBOW/);
  assert.match(warnings[2], /Color 3/);
});

test('Flash lives in the clip-head cluster, not the color cards', () => {
  const viewSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)),
    'utf8',
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  const overlaySrc = readFileSync(
    fileURLToPath(new URL('../public/shared/flash-look-overlay.js', import.meta.url)),
    'utf8',
  );
  const css = readFileSync(
    fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)),
    'utf8',
  );
  const example = JSON.parse(readFileSync(
    fileURLToPath(new URL('../config/config.example.json', import.meta.url)),
    'utf8',
  ));
  assert.match(viewSrc, /view-edit-btn--flash/);
  assert.match(viewSrc, /onStartFlashLook/);
  assert.doesNotMatch(viewSrc, /colors-row[\s\S]*textContent = 'Flash'/);
  assert.match(clientSrc, /openFlashLook/);
  assert.match(clientSrc, /\/api\/sheets\/rows\//);
  assert.match(overlaySrc, /flash-look-overlay/);
  assert.match(overlaySrc, /Write all/);
  assert.match(css, /max-height:\s*50rem/);
  assert.match(css, /flash-look-panel/);
  const lightingCols = example.views.lighting.fields.map((f) => f.column ?? f.source);
  assert.ok(lightingCols.includes('Lighting Notes'));
  assert.ok(!lightingCols.includes('Notch'));
});
