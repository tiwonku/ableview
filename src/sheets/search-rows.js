// In-memory sheet row search for the Add-as-alias UI.

function scoreField(haystack, needle) {
  if (!haystack || !needle) return 0;
  const h = String(haystack).toLowerCase();
  const n = String(needle).toLowerCase();
  if (!n) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.includes(n)) return 50;
  // Token overlap (HotRox vs Hot Like Rox)
  const compactH = h.replace(/[\s_\-]+/g, '');
  const compactN = n.replace(/[\s_\-]+/g, '');
  if (compactH && compactN && (compactH.includes(compactN) || compactN.includes(compactH))) {
    return 40;
  }
  return 0;
}

/**
 * Search cue rows by match column, aliases, and optional secondary columns
 * (e.g. ALS Folder). Returns ranked lightweight results for typeahead.
 */
export function searchSheetRows(snapshot, {
  query = '',
  matchColumn,
  aliasColumn,
  secondaryColumns = [],
  limit = 15,
} = {}) {
  const q = String(query ?? '').trim();
  const rows = snapshot?.rows ?? [];
  if (!rows.length) return [];

  const scored = [];
  for (const row of rows) {
    const data = row.data ?? {};
    const title = data[matchColumn] ?? '';
    if (!String(title).trim()) continue;

    let score = 0;
    if (q) {
      score = Math.max(score, scoreField(title, q));
      if (aliasColumn) score = Math.max(score, scoreField(data[aliasColumn], q));
      for (const col of secondaryColumns) {
        score = Math.max(score, scoreField(data[col], q) * 0.9);
      }
      if (score <= 0) continue;
    } else {
      score = 1;
    }

    scored.push({
      score,
      rowId: String(row.rowId),
      title: String(title).trim(),
      aliases: aliasColumn ? String(data[aliasColumn] ?? '').trim() : '',
      secondary: secondaryColumns
        .map((col) => ({ column: col, value: String(data[col] ?? '').trim() }))
        .filter((s) => s.value),
    });
  }

  scored.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return scored.slice(0, Math.max(1, limit)).map(({ score, ...rest }) => rest);
}
