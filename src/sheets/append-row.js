/** Build a full row array and write to an explicit bottom row (no Google table detection). */

import { columnIndexToLetter, escapeWorksheetName } from './column-letter.js';

/** Next sheet row after the last parsed data row AbleView has seen. */
export function nextAppendRow({ rows, headerRow }) {
  if (!Number.isInteger(headerRow) || headerRow < 1) {
    throw new Error(`headerRow must be a positive integer, got ${headerRow}`);
  }

  if (!rows.length) {
    // Header row + preserved gap row → first data row.
    return headerRow + 2;
  }

  return Math.max(...rows.map((r) => Number(r.rowId))) + 1;
}

export function buildExplicitRowRange(worksheet, rowId, headers) {
  const rowNumber = Number(rowId);
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    throw new Error(`invalid rowId: ${rowId}`);
  }
  if (!headers.length) {
    throw new Error('headers must not be empty');
  }

  const lastCol = columnIndexToLetter(headers.length - 1);
  return `${escapeWorksheetName(worksheet)}!A${rowNumber}:${lastCol}${rowNumber}`;
}

export function buildAppendRowValues(headers, formattedChanges) {
  return headers.map((name) => {
    if (!name) return '';
    return formattedChanges[name] ?? '';
  });
}

/** Map a header-aligned row array back to a column-name data object. */
export function snapshotRowData(headers, rowValues) {
  const data = {};
  for (let i = 0; i < headers.length; i++) {
    const name = headers[i];
    if (!name) continue;
    data[name] = rowValues[i] ?? '';
  }
  return data;
}

export function appendSnapshotRow(snapshot, rowId, data) {
  if (snapshot.rows.some((r) => r.rowId === String(rowId))) {
    throw new Error(`row already exists: ${rowId}`);
  }

  snapshot.rows.push({
    rowId: String(rowId),
    data: { ...data },
  });
}
