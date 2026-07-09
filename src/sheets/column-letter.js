/** 0-based column index → A1 column letter (0 = A, 25 = Z, 26 = AA). */
export function columnIndexToLetter(colIndex) {
  if (!Number.isInteger(colIndex) || colIndex < 0) {
    throw new Error(`column index must be a non-negative integer, got ${colIndex}`);
  }

  let label = '';
  let n = colIndex;
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label;
    n = Math.floor(n / 26) - 1;
  }
  return label;
}

export function escapeWorksheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}
