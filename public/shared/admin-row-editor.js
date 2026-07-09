// Admin matched-row editor with edit-session locking.

import {
  parseCellForEditor,
  normalizeColumnConfig,
  DEFAULT_ICON,
} from './sheet-format.js';
import { parseRgbCell } from './color-parse.js';

export function captureEditSession(payload) {
  const row = payload?.row ?? {};
  return {
    rowId: String(payload.match.rowId),
    row: Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, v == null ? '' : String(v)])
    ),
    clipNameAtEdit: payload.clipName?.trim() ?? '',
    matchedValueAtEdit: payload.match.matchedValue ?? '',
  };
}

export function renderRowEditorPanel(parent, {
  session,
  editorColumns = {},
  livePayload,
  onCancel,
  onSave,
  saveState = 'idle',
  saveError = null,
}) {
  const section = document.createElement('section');
  section.className = 'admin-section admin-editor';
  section.id = 'admin-row-panel';

  const header = document.createElement('div');
  header.className = 'admin-editor-header';

  const heading = document.createElement('h2');
  heading.className = 'section-title';
  heading.textContent = 'Edit row';
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
  form.dataset.rowId = session.rowId;

  for (const [column, raw] of Object.entries(session.row)) {
    form.appendChild(renderEditorField(column, raw, editorColumns[column]));
  }

  section.appendChild(form);
  parent.appendChild(section);
}

function buildEditContext(session, livePayload) {
  const liveClip = livePayload?.clipName?.trim() ?? '';
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

function renderEditorField(column, raw, columnConfig) {
  const cfg = normalizeColumnConfig(columnConfig);
  const field = document.createElement('div');
  field.className = 'row-editor-field';
  field.dataset.column = column;

  const label = document.createElement('label');
  label.className = 'row-editor-label';
  label.textContent = column;
  label.htmlFor = `edit-${cssEscape(column)}`;
  field.appendChild(label);

  const control = document.createElement('div');
  control.className = 'row-editor-control';

  const state = parseCellForEditor(raw, cfg);

  switch (cfg.type) {
    case 'number': {
      const input = document.createElement('input');
      input.type = 'number';
      input.id = `edit-${cssEscape(column)}`;
      input.className = 'row-editor-input';
      input.value = state;
      input.step = String(cfg.step ?? 1);
      input.min = String(cfg.min ?? 0);
      input.dataset.editorType = 'number';
      control.appendChild(input);
      break;
    }
    case 'color': {
      const wrap = document.createElement('div');
      wrap.className = 'row-editor-color';
      wrap.dataset.editorType = 'color';

      const parsed = parseRgbCell(raw);
      const isEmpty = state == null;
      if (isEmpty) wrap.dataset.cleared = 'true';

      const picker = document.createElement('input');
      picker.type = 'color';
      picker.id = `edit-${cssEscape(column)}`;
      picker.className = 'row-editor-color-input';
      picker.value = state ?? '#000000';
      wrap.appendChild(picker);

      const meta = document.createElement('span');
      meta.className = 'row-editor-color-meta';
      meta.textContent = isEmpty ? '—' : (parsed?.rgbText ?? '—');
      meta.dataset.role = 'color-meta';
      wrap.appendChild(meta);

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'row-editor-color-clear';
      clearBtn.textContent = 'Clear';
      clearBtn.title = 'Clear color';
      clearBtn.addEventListener('click', () => setColorCleared(wrap, true));
      wrap.appendChild(clearBtn);

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
      input.id = `edit-${cssEscape(column)}`;
      input.className = 'row-editor-input';
      input.value = state;
      input.dataset.editorType = 'text';
      control.appendChild(input);
      break;
    }
  }

  field.appendChild(control);
  return field;
}

function setColorCleared(wrap, cleared, hex = null) {
  if (cleared) {
    wrap.dataset.cleared = 'true';
  } else {
    delete wrap.dataset.cleared;
    if (hex) wrap.querySelector('.row-editor-color-input').value = hex;
  }
  syncColorClearedUi(wrap);
}

function syncColorClearedUi(wrap) {
  const cleared = wrap.dataset.cleared === 'true';
  const picker = wrap.querySelector('.row-editor-color-input');
  const meta = wrap.querySelector('[data-role="color-meta"]');
  const clearBtn = wrap.querySelector('.row-editor-color-clear');

  wrap.classList.toggle('is-cleared', cleared);
  if (cleared) {
    meta.textContent = '—';
    if (clearBtn) clearBtn.disabled = true;
    return;
  }

  const parsed = parseRgbCell(formatRgbFromHex(picker?.value ?? ''));
  meta.textContent = parsed?.rgbText ?? '—';
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
