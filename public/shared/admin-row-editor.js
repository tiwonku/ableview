// Admin matched-row editor with edit-session locking.

import {
  parseCellForEditor,
  normalizeColumnConfig,
  DEFAULT_ICON,
} from './sheet-format.js';
import { parseRgbCell } from './color-parse.js';
import { openColorPicker } from './color-picker.js';
import { suggestAliasStem } from './alias-stem.js';
import { operatorCreateColumns } from './playing-clips-strip.js';

export function viewFieldColumns(fields) {
  return (fields ?? []).map((field) => field.column).filter(Boolean);
}

export function buildFieldLabels(fields) {
  return Object.fromEntries(
    (fields ?? [])
      .filter((field) => field?.column)
      .map((field) => [field.column, field.label ?? field.column])
  );
}

export function buildViewEditorColumns(fields, editorColumns = {}) {
  const result = {};
  for (const field of fields ?? []) {
    if (!field?.column) continue;
    result[field.column] = editorColumns[field.column]
      ?? (field.type === 'color' ? { type: 'color' } : { type: 'text' });
  }
  return result;
}

export function captureEditSession(payload, { columns } = {}) {
  const row = payload?.row ?? {};
  const keys = columns?.length ? columns : Object.keys(row);
  return {
    mode: 'edit',
    rowId: String(payload.match.rowId),
    row: Object.fromEntries(
      keys.map((column) => [column, row[column] == null ? '' : String(row[column])])
    ),
    clipNameAtEdit: payload.clipName?.trim() ?? '',
    matchedValueAtEdit: payload.match.matchedValue ?? '',
  };
}

export function captureCreateSession({
  clipName,
  headers,
  matchColumn,
  aliasColumn = null,
  columns,
  trackName = null,
  trackIndex = null,
}) {
  const cols = columns?.length ? columns : headers.filter(Boolean);
  const trimmedClip = clipName?.trim() ?? '';
  const row = Object.fromEntries(
    cols.map((name) => {
      if (name === matchColumn) {
        return [name, trimmedClip];
      }
      if (aliasColumn && name === aliasColumn) {
        return [name, suggestAliasStem(trimmedClip) || trimmedClip];
      }
      return [name, ''];
    })
  );

  return {
    mode: 'create',
    rowId: null,
    row,
    clipNameAtEdit: trimmedClip,
    matchedValueAtEdit: '',
    trackName: trackName ?? null,
    trackIndex: trackIndex ?? null,
  };
}

/** Field list for operator create form (title + aliases + view columns). */
export function buildOperatorCreateFields(viewFields, matchColumn, aliasColumn, session) {
  const columns = operatorCreateColumns(viewFields, matchColumn, aliasColumn);
  return columns
    .filter((column) => column in session.row)
    .map((column) => {
      const fromView = (viewFields ?? []).find((f) => f.column === column);
      if (fromView) return fromView;
      return { column, label: column, display: 'text' };
    });
}

export function renderRowEditorPanel(parent, {
  session,
  editorColumns = {},
  fieldLabels = {},
  panelId = 'admin-row-panel',
  livePayload,
  onCancel,
  onSave,
  saveState = 'idle',
  saveError = null,
}) {
  const section = document.createElement('section');
  section.className = 'admin-section admin-editor';
  section.id = panelId;

  const header = document.createElement('div');
  header.className = 'admin-editor-header';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = session.mode === 'create' ? 'Add cue row' : 'Edit row';
  header.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'admin-editor-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'admin-editor-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.disabled = saveState === 'saving';
  cancelBtn.addEventListener('click', onCancel);
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'admin-editor-btn admin-editor-btn--primary';
  saveBtn.textContent = saveState === 'saving' ? 'Saving…' : 'Save';
  saveBtn.disabled = saveState === 'saving';
  saveBtn.addEventListener('click', () => onSave(section));
  actions.appendChild(saveBtn);

  header.appendChild(actions);
  section.appendChild(header);

  const context = document.createElement('p');
  context.className = 'admin-editor-context';
  context.dataset.role = 'edit-context';
  context.textContent = buildEditContext(session, livePayload);
  section.appendChild(context);

  if (saveError) {
    const err = document.createElement('p');
    err.className = 'admin-editor-error';
    err.textContent = saveError;
    section.appendChild(err);
  }

  const form = document.createElement('div');
  form.className = 'row-editor';
  if (session.rowId != null) form.dataset.rowId = session.rowId;

  for (const [column, raw] of Object.entries(session.row)) {
    form.appendChild(renderEditorField(column, raw, editorColumns[column], fieldLabels[column]));
  }

  section.appendChild(form);
  parent.appendChild(section);
}

/** Operator views: card grid matching read-mode layout. Save/Cancel live in the clip-head row. */
export function renderOperatorRowEditorPanel(parent, {
  session,
  fields = [],
  matchColumn = null,
  aliasColumn = null,
  editorColumns = {},
  fieldLabels = {},
  panelId = 'view-row-panel',
  livePayload,
  saveError = null,
}) {
  const section = document.createElement('section');
  section.className = 'operator-editor';
  section.id = panelId;

  const context = document.createElement('p');
  context.className = 'admin-editor-context operator-editor-context';
  context.dataset.role = 'edit-context';
  context.textContent = buildEditContext(session, livePayload);
  section.appendChild(context);

  if (saveError) {
    const err = document.createElement('p');
    err.className = 'admin-editor-error operator-editor-error';
    err.textContent = saveError;
    section.appendChild(err);
  }

  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'view-fields-wrap';

  const form = document.createElement('div');
  form.className = 'fields fields--edit';
  if (session.rowId != null) form.dataset.rowId = session.rowId;

  const fieldList = session.mode === 'create'
    ? buildOperatorCreateFields(fields, matchColumn, aliasColumn, session)
    : (fields?.length
      ? fields.filter((f) => f?.column && f.column in session.row)
      : Object.keys(session.row).map((column) => ({ column, type: editorColumns[column]?.type })));

  for (let i = 0; i < fieldList.length; i++) {
    const field = fieldList[i];
    if (field.type === 'color') {
      const group = [];
      while (i < fieldList.length && fieldList[i].type === 'color') {
        if (fieldList[i].column in session.row) group.push(fieldList[i]);
        i++;
      }
      i--;
      if (group.length) {
        form.appendChild(renderOperatorColorGroup(group, session, editorColumns, fieldLabels));
      }
    } else {
      form.appendChild(
        renderOperatorTextField(field, session, editorColumns, fieldLabels),
      );
    }
  }

  fieldsWrap.appendChild(form);
  section.appendChild(fieldsWrap);
  parent.appendChild(section);
}

function renderOperatorTextField(field, session, editorColumns, fieldLabels) {
  const column = field.column;
  const label = fieldLabels[column] ?? field.label ?? column;
  const raw = session.row[column];

  const card = document.createElement('div');
  card.className = 'field field--edit';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const body = document.createElement('div');
  body.className = 'field-value-body field-value-body--edit';
  body.appendChild(
    renderEditorField(column, raw, editorColumns[column], label, { layout: 'operator' }),
  );
  card.appendChild(body);

  return card;
}

function renderOperatorColorGroup(fields, session, editorColumns, fieldLabels) {
  const row = document.createElement('div');
  row.className = 'colors-row colors-row--edit';

  for (const field of fields) {
    const column = field.column;
    const label = fieldLabels[column] ?? field.label ?? column;
    const raw = session.row[column];

    const card = document.createElement('div');
    card.className = 'field-color field-color--edit';

    const labelEl = document.createElement('p');
    labelEl.className = 'field-label';
    labelEl.textContent = label;
    card.appendChild(labelEl);

    card.appendChild(
      renderEditorField(column, raw, editorColumns[column], label, { layout: 'operator-color' }),
    );
    row.appendChild(card);
  }

  return row;
}

function buildEditContext(session, livePayload) {
  const liveClip = livePayload?.clipName?.trim() ?? '';

  if (session.mode === 'create') {
    const clip = session.clipNameAtEdit || liveClip || 'unknown clip';
    let text = `Adding cue for "${clip}" (no match found)`;
    if (liveClip && liveClip !== session.clipNameAtEdit) {
      text += `. Now playing: "${liveClip}".`;
    }
    return text;
  }

  const opened = session.clipNameAtEdit || session.matchedValueAtEdit || 'unknown clip';
  const label = session.matchedValueAtEdit || opened;
  let text = `Editing row ${session.rowId}`;
  if (label) text += ` — "${label}"`;
  if (session.clipNameAtEdit) text += ` (opened while playing "${session.clipNameAtEdit}")`;
  if (liveClip && liveClip !== session.clipNameAtEdit) {
    text += `. Now playing: "${liveClip}".`;
  }
  return text;
}

export function updateEditContextBanner(root, session, livePayload) {
  const banner = root.querySelector('[data-role="edit-context"]');
  if (banner) banner.textContent = buildEditContext(session, livePayload);
}

function renderEditorField(column, raw, columnConfig, fieldLabel, options = {}) {
  const layout = options.layout ?? 'admin';
  const cfg = normalizeColumnConfig(columnConfig);
  const field = document.createElement('div');
  field.className = 'row-editor-field';
  field.dataset.column = column;

  const inputId = `edit-${cssEscape(column)}`;

  if (layout === 'admin') {
    const label = document.createElement('label');
    label.className = 'row-editor-label';
    label.textContent = fieldLabel ?? column;
    label.htmlFor = inputId;
    field.appendChild(label);
  }

  const control = document.createElement('div');
  control.className = 'row-editor-control';
  if (layout === 'operator') control.classList.add('row-editor-control--operator');
  if (layout === 'operator-color') control.classList.add('row-editor-control--operator-color');

  const state = parseCellForEditor(raw, cfg);

  switch (cfg.type) {
    case 'number': {
      const input = document.createElement('input');
      input.type = 'number';
      input.id = inputId;
      input.className = 'row-editor-input' + (layout === 'operator' ? ' row-editor-input--operator' : '');
      input.value = state;
      input.step = String(cfg.step ?? 1);
      input.min = String(cfg.min ?? 0);
      input.dataset.editorType = 'number';
      control.appendChild(input);
      break;
    }
    case 'color': {
      const operatorColor = layout === 'operator-color';
      const wrap = document.createElement('div');
      wrap.className = 'row-editor-color' + (operatorColor ? ' row-editor-color--operator' : '');
      wrap.dataset.editorType = 'color';

      const parsed = parseRgbCell(raw);
      const isEmpty = state == null;
      if (isEmpty) wrap.dataset.cleared = 'true';

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.id = inputId;
      picker.value = normalizeHexForPicker(isEmpty ? null : state);

      if (operatorColor) {
        picker.className = 'row-editor-color-input row-editor-color-input--hidden';
        picker.tabIndex = -1;
        picker.setAttribute('aria-hidden', 'true');

        const swatchHost = document.createElement('div');
        swatchHost.className = 'color-swatch-edit';

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'color-swatch-open';
        openBtn.setAttribute('aria-label', `Pick ${fieldLabel ?? column} color`);
        openBtn.title = `Pick ${fieldLabel ?? column} color`;

        const preview = document.createElement('div');
        preview.className = 'color-swatch color-swatch--edit';
        preview.dataset.role = 'color-preview';
        preview.setAttribute('aria-hidden', 'true');
        openBtn.appendChild(preview);

        const badge = document.createElement('span');
        badge.className = 'color-swatch-edit-badge';
        badge.textContent = 'Pick';
        badge.setAttribute('aria-hidden', 'true');
        openBtn.appendChild(badge);

        openBtn.addEventListener('click', () => {
          const cleared = wrap.dataset.cleared === 'true';
          const currentHex = cleared ? null : picker.value;
          openColorPicker({
            title: fieldLabel ?? column,
            hex: currentHex,
            onInput: (hex) => setColorCleared(wrap, false, hex),
            onCancel: () => {
              if (cleared) setColorCleared(wrap, true);
              else setColorCleared(wrap, false, currentHex);
            },
            onClear: () => setColorCleared(wrap, true),
          });
        });

        swatchHost.appendChild(openBtn);
        wrap.appendChild(swatchHost);
        wrap.appendChild(picker);
      } else {
        picker.className = 'row-editor-color-input';
        wrap.appendChild(picker);
      }

      const valuesRow = operatorColor ? document.createElement('div') : null;
      if (valuesRow) valuesRow.className = 'color-values color-values--edit';

      const meta = document.createElement('span');
      meta.className = operatorColor ? 'row-editor-color-meta color-copy-value' : 'row-editor-color-meta';
      meta.textContent = isEmpty ? '—' : (parsed?.rgbText ?? '—');
      meta.dataset.role = 'color-meta';

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = operatorColor ? 'row-editor-color-clear color-copy' : 'row-editor-color-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.title = 'Clear color';
      clearBtn.addEventListener('click', () => setColorCleared(wrap, true));

      if (operatorColor) {
        const rgbRow = document.createElement('div');
        rgbRow.className = 'color-copy color-copy--meta';
        const rgbKind = document.createElement('span');
        rgbKind.className = 'color-copy-kind';
        rgbKind.textContent = 'RGB';
        rgbRow.appendChild(rgbKind);
        rgbRow.appendChild(meta);
        valuesRow.appendChild(rgbRow);

        const hexInput = document.createElement('input');
        hexInput.type = 'text';
        hexInput.className = 'row-editor-color-hex';
        hexInput.dataset.role = 'color-hex';
        hexInput.autocomplete = 'off';
        hexInput.spellcheck = false;
        hexInput.placeholder = '#RRGGBB';
        hexInput.setAttribute('aria-label', `${fieldLabel ?? column} hex color`);
        hexInput.addEventListener('change', () => commitColorHexInput(wrap));
        hexInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitColorHexInput(wrap);
          }
        });

        const hexRow = document.createElement('div');
        hexRow.className = 'color-copy color-copy--hex';
        const hexKind = document.createElement('span');
        hexKind.className = 'color-copy-kind';
        hexKind.textContent = 'Hex';
        hexRow.appendChild(hexKind);
        hexRow.appendChild(hexInput);
        valuesRow.appendChild(hexRow);

        valuesRow.appendChild(clearBtn);
        wrap.appendChild(valuesRow);
      } else {
        wrap.appendChild(meta);
        wrap.appendChild(clearBtn);
      }

      picker.addEventListener('input', () => {
        setColorCleared(wrap, false, picker.value);
      });

      syncColorClearedUi(wrap);
      control.appendChild(wrap);
      break;
    }
    case 'icon': {
      const toggle = document.createElement('div');
      toggle.className = 'row-editor-icon-toggle';
      toggle.dataset.editorType = 'icon';
      toggle.dataset.trueValue = cfg.true;
      toggle.dataset.falseValue = cfg.false;

      const trueBtn = document.createElement('button');
      trueBtn.type = 'button';
      trueBtn.className = 'icon-toggle-btn' + (state ? ' is-active' : '');
      trueBtn.textContent = cfg.true;
      trueBtn.title = 'Yes';
      trueBtn.addEventListener('click', () => setIconState(toggle, true));

      const falseBtn = document.createElement('button');
      falseBtn.type = 'button';
      falseBtn.className = 'icon-toggle-btn' + (!state ? ' is-active' : '');
      falseBtn.textContent = cfg.false;
      falseBtn.title = 'No';
      falseBtn.addEventListener('click', () => setIconState(toggle, false));

      toggle.appendChild(trueBtn);
      toggle.appendChild(falseBtn);
      toggle.dataset.value = state ? 'true' : 'false';
      control.appendChild(toggle);
      break;
    }
    default: {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = inputId;
      input.className = 'row-editor-input' + (layout === 'operator' ? ' row-editor-input--operator' : '');
      input.value = state;
      input.dataset.editorType = 'text';
      control.appendChild(input);
      break;
    }
  }

  field.appendChild(control);
  return field;
}

function normalizeHexForPicker(hex) {
  if (hex == null || String(hex).trim() === '') return '#000000';
  let h = String(hex).trim();
  if (!h.startsWith('#')) h = `#${h}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(h)) return '#000000';
  return h.toLowerCase();
}

function parseHexInput(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return null;
  return withHash.toLowerCase();
}

function commitColorHexInput(wrap) {
  const hexInput = wrap.querySelector('[data-role="color-hex"]');
  if (!hexInput || hexInput.disabled) return;
  const parsed = parseHexInput(hexInput.value);
  if (!parsed) {
    syncColorClearedUi(wrap);
    return;
  }
  setColorCleared(wrap, false, parsed);
}

function setColorCleared(wrap, cleared, hex = null) {
  if (cleared) {
    wrap.dataset.cleared = 'true';
  } else {
    delete wrap.dataset.cleared;
    if (hex) {
      wrap.querySelector('.row-editor-color-input').value = normalizeHexForPicker(hex);
    }
  }
  syncColorClearedUi(wrap);
}

function syncColorClearedUi(wrap) {
  const cleared = wrap.dataset.cleared === 'true';
  const picker = wrap.querySelector('.row-editor-color-input');
  const meta = wrap.querySelector('[data-role="color-meta"]');
  const hexInput = wrap.querySelector('[data-role="color-hex"]');
  const preview = wrap.querySelector('[data-role="color-preview"]');
  const clearBtn = wrap.querySelector('.row-editor-color-clear');

  wrap.classList.toggle('is-cleared', cleared);
  if (cleared) {
    if (meta) meta.textContent = '—';
    if (hexInput) {
      hexInput.value = '';
      hexInput.disabled = true;
    }
    if (preview) {
      preview.style.backgroundColor = '';
      preview.classList.add('color-swatch--empty');
    }
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  const parsed = parseRgbCell(formatRgbFromHex(picker?.value ?? ''));
  if (meta) meta.textContent = parsed?.rgbText ?? '—';
  if (hexInput) {
    hexInput.disabled = false;
    hexInput.value = parsed?.hex ?? normalizeHexForPicker(picker?.value);
  }
  if (preview) {
    preview.classList.remove('color-swatch--empty');
    preview.style.backgroundColor = parsed?.css ?? '';
  }
  if (clearBtn) clearBtn.disabled = false;
}

function setIconState(toggle, value) {
  toggle.dataset.value = value ? 'true' : 'false';
  const [trueBtn, falseBtn] = toggle.querySelectorAll('.icon-toggle-btn');
  trueBtn.classList.toggle('is-active', value);
  falseBtn.classList.toggle('is-active', !value);
}

function formatRgbFromHex(hex) {
  const normalized = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '';
  const n = Number.parseInt(normalized, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r},${g},${b}`;
}

export function collectEditorChanges(formEl, originalRow) {
  const changes = {};

  for (const field of formEl.querySelectorAll('.row-editor-field')) {
    const column = field.dataset.column;
    const value = readFieldValue(field);
    const original = originalRow[column] ?? '';
    if (!valuesEqual(value, original, field)) {
      changes[column] = value;
    }
  }

  return changes;
}

export function collectEditorValues(formEl) {
  const values = {};

  for (const field of formEl.querySelectorAll('.row-editor-field')) {
    const column = field.dataset.column;
    values[column] = readFieldValue(field);
  }

  return values;
}

function readFieldValue(field) {
  const colorWrap = field.querySelector('[data-editor-type="color"]');
  if (colorWrap) {
    if (colorWrap.dataset.cleared === 'true') return '';
    return colorWrap.querySelector('input[type="color"]')?.value ?? '';
  }

  const type = field.querySelector('[data-editor-type]')?.dataset.editorType ?? 'text';

  switch (type) {
    case 'number':
      return field.querySelector('input')?.value ?? '';
    case 'icon': {
      const toggle = field.querySelector('[data-editor-type="icon"]');
      return toggle?.dataset.value === 'true';
    }
    default:
      return field.querySelector('input')?.value ?? '';
  }
}

function valuesEqual(value, original, field) {
  const colorWrap = field.querySelector('[data-editor-type="color"]');
  if (colorWrap) {
    const originalEmpty = !String(original ?? '').trim();
    if (colorWrap.dataset.cleared === 'true') return originalEmpty;
    const hex = String(value);
    const fromOriginal = parseRgbCell(original);
    return fromOriginal?.hex?.toUpperCase() === hex.toUpperCase();
  }

  const type = field.querySelector('[data-editor-type]')?.dataset.editorType ?? 'text';
  if (type === 'icon') {
    const cfg = {
      true: field.querySelector('[data-editor-type="icon"]')?.dataset.trueValue ?? DEFAULT_ICON.true,
      false: field.querySelector('[data-editor-type="icon"]')?.dataset.falseValue ?? DEFAULT_ICON.false,
    };
    const formatted = value ? cfg.true : cfg.false;
    return formatted === String(original);
  }
  return String(value) === String(original);
}

function cssEscape(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Open the operator color picker for a column after the edit form is mounted. */
export function openOperatorColorField(root, column) {
  if (!root || column == null || column === '') return false;
  const fields = root.querySelectorAll('.row-editor-field[data-column]');
  for (const field of fields) {
    if (field.dataset.column !== String(column)) continue;
    const btn = field.querySelector('.color-swatch-open');
    if (!btn) return false;
    btn.click();
    return true;
  }
  return false;
}

export function renderReadOnlyRowPanel(parent, { payload, onStartEdit }) {
  const section = document.createElement('section');
  section.className = 'admin-section';
  section.id = 'admin-row-panel';

  const header = document.createElement('div');
  header.className = 'admin-editor-header';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Matched row';
  header.appendChild(heading);

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'admin-editor-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', onStartEdit);
  header.appendChild(editBtn);

  section.appendChild(header);

  const table = document.createElement('dl');
  table.className = 'row-table';
  for (const [column, raw] of Object.entries(payload.row)) {
    const value = raw == null || String(raw).trim() === '' ? '—' : String(raw);

    const dt = document.createElement('dt');
    dt.textContent = column;
    table.appendChild(dt);

    const dd = document.createElement('dd');
    dd.textContent = value;
    table.appendChild(dd);
  }
  section.appendChild(table);
  parent.appendChild(section);
}
