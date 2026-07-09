import { validateAndFormatChanges } from '../../public/shared/sheet-format.js';
import { columnIndexToLetter, escapeWorksheetName } from './column-letter.js';

export function buildRowUpdateRanges({ worksheet, headers, rowId, changes }) {
  const rowNumber = Number(rowId);
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    throw new Error(`invalid rowId: ${rowId}`);
  }

  const sheetPrefix = `${escapeWorksheetName(worksheet)}!`;
  const data = [];

  for (const [column, value] of Object.entries(changes)) {
    const colIndex = headers.indexOf(column);
    if (colIndex < 0) {
      throw new Error(`unknown column: ${column}`);
    }
    const cell = `${sheetPrefix}${columnIndexToLetter(colIndex)}${rowNumber}`;
    data.push({ range: cell, values: [[value]] });
  }

  return data;
}

export function formatChangesForSheet(changes, editorColumns, headers) {
  return validateAndFormatChanges(changes, editorColumns, headers);
}

export function patchSnapshotRow(snapshot, rowId, formattedChanges) {
  const row = snapshot.rows.find((r) => r.rowId === String(rowId));
  if (!row) {
    throw new Error(`row not found: ${rowId}`);
  }

  for (const [column, value] of Object.entries(formattedChanges)) {
    row.data[column] = value;
  }
}
