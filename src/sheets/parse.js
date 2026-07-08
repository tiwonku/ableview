// Parse a raw 2D grid from Google Sheets into header names + row objects.
// headerRow is 1-based (matches how users see row numbers in the sheet UI).

export function parseSheetGrid(values, { headerRow = 1 } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return { headers: [], rows: [] };
  }

  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new Error(`headerRow must be a positive integer, got ${headerRow}`);
  }

  const headerIndex = headerRow - 1;
  if (headerIndex >= values.length) {
    throw new Error(
      `headerRow ${headerRow} is outside the fetched range (${values.length} row(s) returned)`
    );
  }

  const headerCells = values[headerIndex] ?? [];
  const headers = headerCells.map((cell) => String(cell ?? '').trim());

  const rows = [];
  for (let i = headerIndex + 1; i < values.length; i++) {
    const cells = values[i] ?? [];
    const data = {};
    for (let c = 0; c < headers.length; c++) {
      const name = headers[c];
      if (!name) continue;
      data[name] = cells[c] != null ? String(cells[c]) : '';
    }
    if (isBlankRow(data)) continue;

    rows.push({
      rowId: String(i + 1), // actual sheet row number (1-based)
      data,
    });
  }

  return { headers, rows };
}

function isBlankRow(data) {
  return Object.values(data).every((v) => !String(v).trim());
}

export function getMatchValues(rows, matchColumn) {
  return rows
    .map((r) => r.data[matchColumn]?.trim())
    .filter(Boolean);
}
