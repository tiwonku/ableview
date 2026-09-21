import { applyColorSwatchStyle, rgbToHex } from './color-parse.js';

export const DEFAULT_LIVE_COLOR_COLUMNS = Object.freeze({
  RGB_1: 'main',
  RGB_2: 'secondary',
  RGB_3: 'accent',
});

const SLOT_LABELS = Object.freeze({
  main: 'Main',
  secondary: 'Secondary',
  accent: 'Accent',
});

export function rgbToLiveDisplay(c) {
  if (!c || !Number.isInteger(c.r) || !Number.isInteger(c.g) || !Number.isInteger(c.b)) return null;
  return {
    r: c.r,
    g: c.g,
    b: c.b,
    css: `rgb(${c.r}, ${c.g}, ${c.b})`,
    hex: rgbToHex(c.r, c.g, c.b),
    rgbText: `${c.r}, ${c.g}, ${c.b}`,
  };
}

export function slotForColumn(column, map = DEFAULT_LIVE_COLOR_COLUMNS) {
  return map?.[column] ?? DEFAULT_LIVE_COLOR_COLUMNS[column] ?? null;
}

export function hasSlotColors(colors) {
  return ['main', 'secondary', 'accent'].some((id) => {
    const c = colors?.[id];
    return c && Number.isInteger(c.r) && Number.isInteger(c.g) && Number.isInteger(c.b);
  });
}

/** Static look bus when present; otherwise the FX triple (pre-patch fallback). */
export function lookColorsFromStatus(status) {
  if (hasSlotColors(status?.staticColors)) return status.staticColors;
  if (hasSlotColors(status?.colors)) return status.colors;
  return null;
}

/** Live overlay only when sACN is on and that slot has a known RGB. */
export function liveOverlayVisible(status, slot) {
  if (status?.enabled !== true || !slot) return false;
  return Boolean(rgbToLiveDisplay(status.colors?.[slot]));
}

/** Empty sheet color stays hidden unless editing or GrandMA has a value. */
export function colorFieldVisible({ sheetColor = false, liveColor = false, editing = false } = {}) {
  if (editing) return true;
  return Boolean(sheetColor) || Boolean(liveColor);
}

export function renderLiveColorHost(column) {
  const live = document.createElement('div');
  live.className = 'color-live';
  live.hidden = true;
  live.dataset.role = 'live-color';
  live.dataset.liveColumn = column;

  const kicker = document.createElement('p');
  kicker.className = 'color-live-kicker';
  kicker.textContent = 'GrandMA';
  live.appendChild(kicker);

  const swatch = document.createElement('div');
  swatch.className = 'color-swatch color-swatch--live';
  swatch.dataset.role = 'live-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  live.appendChild(swatch);

  const meta = document.createElement('p');
  meta.className = 'color-live-meta';
  meta.dataset.role = 'live-meta';
  meta.textContent = 'No signal';
  live.appendChild(meta);

  return live;
}

export function applyLiveColorOverlay(root, status, columnMap = DEFAULT_LIVE_COLOR_COLUMNS) {
  if (!root) return;
  const hosts = root.querySelectorAll('[data-role="live-color"]');

  for (const host of hosts) {
    const column = host.dataset.liveColumn;
    const slot = slotForColumn(column, columnMap);
    const color = rgbToLiveDisplay(status?.colors?.[slot]);
    const showLive = liveOverlayVisible(status, slot);
    host.hidden = !showLive;

    const live = status?.live === true;
    const swatch = host.querySelector('[data-role="live-swatch"]');
    const meta = host.querySelector('[data-role="live-meta"]');
    applyColorSwatchStyle(swatch, color);
    host.classList.toggle('color-live--stale', showLive && !live);
    host.classList.toggle('color-live--live', showLive && live && Boolean(color));

    let text = 'No signal';
    if (!live && color) text = `Stale ${color.rgbText}`;
    else if (!live) text = 'No signal';
    else if (color) text = color.rgbText;
    else text = 'No data';

    if (meta) meta.textContent = text;
    swatch?.setAttribute(
      'aria-label',
      `GrandMA ${SLOT_LABELS[slot] ?? slot}: ${text}`,
    );

    const field = host.closest('.field-color--empty');
    if (field && !field.querySelector('.color-swatch-open')) {
      field.hidden = !showLive;
    }
  }

  for (const row of root.querySelectorAll('.colors-row')) {
    const fields = [...row.querySelectorAll(':scope > .field-color')];
    row.hidden = fields.length > 0 && fields.every((field) => field.hidden);
  }
  for (const mast of root.querySelectorAll('.admin-dashboard-mast')) {
    const rows = [...mast.querySelectorAll('.colors-row')];
    mast.hidden = rows.length > 0 && rows.every((row) => row.hidden);
  }
}
