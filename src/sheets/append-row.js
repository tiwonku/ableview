/** Build a full row array and patch in-memory snapshot after append. */

export function buildAppendRowValues(headers, formattedChanges) {
  return headers.map((name) => {
    if (!name) return '';
    return formattedChanges[name] ?? '';
  });
}

export function parseAppendedRowId(updatedRange) {
  if (!updatedRange || typeof updatedRange !== 'string') {
    throw new Error('append response missing updatedRange');
  }

  const rangeMatch = updatedRange.match(/:(\d+)$/);
  if (rangeMatch) return String(rangeMatch[1]);

  const cellMatch = updatedRange.match(/!.*?(\d+)$/);
  if (cellMatch) return String(cellMatch[1]);

  throw new Error(`could not parse row id from updatedRange: ${updatedRange}`);
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
