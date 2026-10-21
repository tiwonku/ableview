// Columns the Set page can edit in the row modal.
// Operator view fields, plus the match/alias/key columns and typed editor columns.
// Archival sheet columns stay on the full admin editor.

import { KEY_COLUMN } from './index.js';

function addField(fields, seen, column, { label, multiline = false } = {}) {
  const name = String(column ?? '').trim();
  if (!name || seen.has(name)) return;
  seen.add(name);
  const text = String(label ?? '').trim();
  fields.push({
    column: name,
    label: text || name,
    multiline: Boolean(multiline),
  });
}

/**
 * Ordered cue fields for the setlist row modal.
 * @returns {Array<{ column: string, label: string, multiline: boolean }>}
 */
export function setlistEditFields(config) {
  const sheets = config?.sheets ?? {};
  const editorColumns = sheets.editorColumns ?? {};
  const matchColumn = String(sheets.matchColumn ?? '').trim();
  const aliasColumn = String(sheets.aliasColumn ?? '').trim();
  const fields = [];
  const seen = new Set();

  if (matchColumn) addField(fields, seen, matchColumn);
  if (aliasColumn) addField(fields, seen, aliasColumn);
  addField(fields, seen, KEY_COLUMN, { label: 'Key' });

  for (const [column, spec] of Object.entries(editorColumns)) {
    if (spec?.type === 'number') addField(fields, seen, column, { label: spec.label });
  }

  const views = config?.views ?? {};
  for (const view of Object.values(views)) {
    if (!view || view.system || !Array.isArray(view.fields)) continue;
    for (const field of view.fields) {
      if (!field?.column || field.type === 'camelot') continue;
      addField(fields, seen, field.column, {
        label: field.label,
        multiline: field.display === 'note',
      });
    }
  }

  for (const [column, spec] of Object.entries(editorColumns)) {
    addField(fields, seen, column, { label: spec?.label });
  }

  return fields;
}

/** Drop columns that are not on the loaded sheet. An empty header list keeps the configured fields. */
export function setlistEditFieldsForHeaders(config, headers) {
  const fields = setlistEditFields(config);
  const known = new Set((headers ?? []).map((header) => String(header ?? '').trim()).filter(Boolean));
  if (known.size === 0) return fields;
  return fields.filter((field) => known.has(field.column));
}
