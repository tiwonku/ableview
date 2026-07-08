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
