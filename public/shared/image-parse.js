// Parse sheet image cells: =IMAGE("url") formulas or bare http(s) URLs.

const IMAGE_FORMULA_RE = /^=IMAGE\s*\(\s*(['"])(.+?)\1/i;

export function parseImageCell(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const formula = text.match(IMAGE_FORMULA_RE);
  if (formula) {
    const url = formula[2].trim();
    if (!url) return null;
    return { url, formula: text };
  }

  if (/^https?:\/\//i.test(text)) {
    return { url: text, formula: null };
  }

  return null;
}

export function formatImageCellForSheet(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const parsed = parseImageCell(text);
  if (!parsed) return text;
  return `=IMAGE("${parsed.url}", 1)`;
}
