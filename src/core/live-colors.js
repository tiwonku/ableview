// Live GrandMA colors (sACN) — listener → views / session log.
// Independent of CuePayload.row (sheet RGB stays the reference look).

export const LIVE_COLOR_SLOTS = Object.freeze(['main', 'secondary', 'accent']);

export const DEFAULT_LIVE_COLOR_COLUMNS = Object.freeze({
  RGB_1: 'main',
  RGB_2: 'secondary',
  RGB_3: 'accent',
});

export const DEFAULT_LIVE_COLOR_SLOTS = Object.freeze({
  main: { startChannel: 500, label: 'Color Main' },
  secondary: { startChannel: 503, label: 'Color secondary' },
  accent: { startChannel: 506, label: 'Color accent' },
});

export const DEFAULT_STATIC_COLOR_SLOTS = Object.freeze({
  main: { startChannel: 491, label: 'Look Main' },
  secondary: { startChannel: 494, label: 'Look secondary' },
  accent: { startChannel: 497, label: 'Look accent' },
});

export function emptySlotColors() {
  return { main: null, secondary: null, accent: null };
}

export function hasSlotColors(colors) {
  return LIVE_COLOR_SLOTS.some((id) => {
    const c = colors?.[id];
    return c && Number.isInteger(c.r) && Number.isInteger(c.g) && Number.isInteger(c.b);
  });
}

/** True when the FX bus differs from the static look by at least changeDelta. */
export function isFxDivergedFromLook(colors, staticColors, { changeDelta = 4 } = {}) {
  if (!hasSlotColors(colors) || !hasSlotColors(staticColors)) return false;
  return maxChannelDelta(colors, staticColors) >= changeDelta;
}

export function cloneSlotColors(colors) {
  const out = emptySlotColors();
  if (!colors || typeof colors !== 'object') return out;
  for (const id of LIVE_COLOR_SLOTS) {
    const c = colors[id];
    if (c && Number.isInteger(c.r) && Number.isInteger(c.g) && Number.isInteger(c.b)) {
      out[id] = { r: c.r, g: c.g, b: c.b };
    }
  }
  return out;
}

export function maxChannelDelta(a, b) {
  let max = 0;
  for (const id of LIVE_COLOR_SLOTS) {
    const ca = a?.[id];
    const cb = b?.[id];
    if (!ca && !cb) continue;
    if (!ca || !cb) return 255;
    max = Math.max(
      max,
      Math.abs(ca.r - cb.r),
      Math.abs(ca.g - cb.g),
      Math.abs(ca.b - cb.b),
    );
  }
  return max;
}

export function makeRgb(r, g, b) {
  if (![r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  return { r, g, b };
}

export function makeLiveColorsStatus({
  enabled,
  live = false,
  lastSeenAt = null,
  universe = null,
  sourceName = null,
  sourceAddress = null,
  preview = false,
  colors = null,
  staticColors = null,
  moving = false,
} = {}) {
  return {
    enabled: enabled === true,
    live: live === true,
    lastSeenAt,
    universe,
    sourceName,
    sourceAddress,
    preview: preview === true,
    colors: cloneSlotColors(colors),
    staticColors: cloneSlotColors(staticColors),
    moving: moving === true,
  };
}
