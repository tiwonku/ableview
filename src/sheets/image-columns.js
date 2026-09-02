import { columnIndexToLetter, escapeWorksheetName } from './column-letter.js';

export function collectImageColumns(config) {
  const names = new Set();
  for (const [column, cfg] of Object.entries(config?.sheets?.editorColumns ?? {})) {
    if (cfg?.type === 'image' && column) names.add(column);
  }
  for (const view of Object.values(config?.views ?? {})) {
    for (const field of view?.fields ?? []) {
      if (field?.type === 'image' && field.column) names.add(field.column);
    }
  }
  return [...names];
}

/** Overlay FORMULA values onto blank formatted cells (IMAGE() formulas render empty). */
export function applyFormulaOverlay(rows, column, columnValues) {
  let filled = 0;
  for (const row of rows) {
    const sheetRow = Number(row.rowId);
    if (!Number.isInteger(sheetRow) || sheetRow < 1) continue;
    const formula = columnValues[sheetRow - 1]?.[0];
    if (formula == null || String(formula).trim() === '') continue;
    const current = String(row.data[column] ?? '').trim();
    if (current) continue;
    row.data[column] = String(formula);
    filled += 1;
  }
  return filled;
}

export async function overlayImageFormulas({
  client,
  sheetId,
  worksheet,
  headers,
  rows,
  columns,
}) {
  let filled = 0;
  for (const column of columns) {
    const idx = headers.indexOf(column);
    if (idx < 0) continue;
    const range = `${escapeWorksheetName(worksheet)}!${columnIndexToLetter(idx)}:${columnIndexToLetter(idx)}`;
    const res = await client.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
      valueRenderOption: 'FORMULA',
    });
    filled += applyFormulaOverlay(rows, column, res.data.values ?? []);
  }
  return filled;
}

export function partitionChangesByInputOption(formatted, editorColumns = {}) {
  const raw = {};
  const userEntered = {};
  for (const [column, value] of Object.entries(formatted)) {
    const asFormula = editorColumns[column]?.type === 'image' && String(value).trim().startsWith('=');
    if (asFormula) userEntered[column] = value;
    else raw[column] = value;
  }
  return { raw, userEntered };
}
