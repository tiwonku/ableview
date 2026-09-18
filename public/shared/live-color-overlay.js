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
  const enabled = status?.enabled === true;

  for (const host of hosts) {
    const column = host.dataset.liveColumn;
    const slot = slotForColumn(column, columnMap);
    if (!enabled || !slot) {
      host.hidden = true;
      continue;
    }

    host.hidden = false;
    const live = status.live === true;
    const color = rgbToLiveDisplay(status.colors?.[slot]);
    const swatch = host.querySelector('[data-role="live-swatch"]');
    const meta = host.querySelector('[data-role="live-meta"]');
    applyColorSwatchStyle(swatch, color);
    host.classList.toggle('color-live--stale', !live);
    host.classList.toggle('color-live--live', live && Boolean(color));

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
  }
}
