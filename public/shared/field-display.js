// Field display tiers for operator views (token / text / note).

const NOTE_NAME_PATTERN = /notes?|panels|description|comment/i;
const TOKEN_NAME_PATTERN = /^(key|relative key|bpm|notch|lasers)$/i;

/** @returns {'token' | 'text' | 'note'} */
export function resolveFieldDisplay(field, value, { layout = 'hero' } = {}) {
  if (field.type === 'color') return 'token';

  const explicit = field.display;
  if (explicit === 'token' || explicit === 'text' || explicit === 'note') {
    return explicit;
  }

  const nameHint = `${field.label ?? ''} ${field.column ?? ''}`;
  if (NOTE_NAME_PATTERN.test(nameHint)) return 'note';

  const trimmed = value?.trim() ?? '';
  if (trimmed) {
    if (trimmed.length <= 12 && !/\s/.test(trimmed)) return 'token';
    if (trimmed.length > 80 || trimmed.includes('\n')) return 'note';
    return 'text';
  }

  if (
    layout !== 'strip'
    && TOKEN_NAME_PATTERN.test(String(field.column ?? '').trim())
  ) {
    return 'token';
  }
  return 'text';
}

export function getFieldValue(field, payload) {
  const raw = payload?.row?.[field.column];
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw);
}

export const ROW_MAX_FIELDS = 3;

/** @returns {'hero' | 'strip'} */
export function resolveFieldsLayoutMode(fields) {
  const hasColor = fields.some((f) => f.type === 'color');
  if (fields.length <= 3 && !hasColor) return 'hero';
  return 'strip';
}

/** @typedef {{ type: 'colors', fields: object[] } | { type: 'note', field: object } | { type: 'row', items: { field: object, display: string }[] }} FieldLayoutRow */

/** @returns {FieldLayoutRow[]} */
export function groupFieldsForLayout(fields, payload) {
  const rows = [];
  let i = 0;

  while (i < fields.length) {
    const field = fields[i];

    if (field.type === 'color') {
      const group = [];
      while (i < fields.length && fields[i].type === 'color') {
        group.push(fields[i]);
        i++;
      }
      rows.push({ type: 'colors', fields: group });
      continue;
    }

    const display = resolveFieldDisplay(field, getFieldValue(field, payload));
    if (display === 'note') {
      rows.push({ type: 'note', field });
      i++;
      continue;
    }

    const items = [];
    while (i < fields.length && fields[i].type !== 'color') {
      const nextField = fields[i];
      const nextDisplay = resolveFieldDisplay(nextField, getFieldValue(nextField, payload));
      if (nextDisplay === 'note') break;
      items.push({ field: nextField, display: nextDisplay });
      i++;
      if (items.length >= ROW_MAX_FIELDS) break;
    }
    rows.push({ type: 'row', items });
  }

  return rows;
}
