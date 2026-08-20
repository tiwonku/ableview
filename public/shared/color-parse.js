// Parse sheet RGB cells (e.g. "109,158,235") → display values.

export function parseRgbCell(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.length !== 3) return null;

  const rgb = parts.map((n) => Number(n));
  if (rgb.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;

  const [r, g, b] = rgb;
  const hex =
    '#' +
    [r, g, b]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

  return {
    r,
    g,
    b,
    css: `rgb(${r}, ${g}, ${b})`,
    hex,
    rgbText: `${r}, ${g}, ${b}`,
  };
}

export function rgbToHex(r, g, b) {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(Number(c)))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Parse #RGB or #RRGGBB (with or without hash). */
export function hexToRgb(hex) {
  let h = String(hex ?? '').trim();
  if (!h) return null;
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3 && /^[0-9a-fA-F]{3}$/.test(h)) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = Number.parseInt(h, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

export function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : d / max,
    v: max,
  };
}

export function hsvToRgb(h, s, v) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = Math.min(1, Math.max(0, Number(s)));
  const val = Math.min(1, Math.max(0, Number(v)));
  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}
