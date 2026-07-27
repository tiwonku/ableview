// Shared view rendering (spec §9.4). Maps CuePayload + field config → DOM.

import { parseRgbCell } from './color-parse.js';
import {
  captureEditSession,
  renderRowEditorPanel,
  renderReadOnlyRowPanel,
  updateEditContextBanner,
  buildViewEditorColumns,
  buildFieldLabels,
} from './admin-row-editor.js';

/** @type {HTMLElement | null} */
let fieldExpandOverlay = null;

function ensureFieldExpandOverlay() {
  if (fieldExpandOverlay) return fieldExpandOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'field-expand-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'field-expand-backdrop';
  backdrop.setAttribute('aria-label', 'Close');
  backdrop.addEventListener('click', closeFieldExpand);
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'field-expand-panel';

  const header = document.createElement('div');
  header.className = 'field-expand-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'field-expand-title';
  titleEl.id = 'field-expand-title';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'field-expand-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeFieldExpand);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'field-expand-body';
  body.id = 'field-expand-body';
  panel.appendChild(body);

  overlay.appendChild(panel);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFieldExpand();
  });

  document.body.appendChild(overlay);
  fieldExpandOverlay = overlay;
  return overlay;
}

function openFieldExpand(label, text) {
  const overlay = ensureFieldExpandOverlay();
  const titleEl = overlay.querySelector('#field-expand-title');
  const bodyEl = overlay.querySelector('#field-expand-body');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = label;
  bodyEl.textContent = text;
  overlay.hidden = false;
  document.body.classList.add('field-expand-open');

  const closeBtn = overlay.querySelector('.field-expand-close');
  closeBtn?.focus();
}

function closeFieldExpand() {
  if (!fieldExpandOverlay || fieldExpandOverlay.hidden) return;
  fieldExpandOverlay.hidden = true;
  document.body.classList.remove('field-expand-open');
}

function isLaunching(payload) {
  return Boolean(payload?.pendingLaunch) && !payload?.simulated;
}

function renderClipNameRow(parent, clipName, payload) {
  const row = document.createElement('div');
  row.className = 'clip-head' + (isLaunching(payload) ? ' clip-head--launching' : '');

  const clipEl = document.createElement('p');
  clipEl.className = 'clip-name' + (clipName ? '' : ' empty-clip');

  if (clipName) {
    const text = document.createElement('span');
    text.className = 'clip-name-text';
    text.textContent = clipName;
    clipEl.appendChild(text);

    if (isLaunching(payload)) {
      const badge = document.createElement('span');
      badge.className = 'clip-launching-badge';
      badge.textContent = 'LAUNCHING';
      badge.setAttribute('role', 'status');
      badge.title = 'Clip launched — waiting for downbeat';
      clipEl.appendChild(badge);
    }
  } else {
    clipEl.textContent = 'Nothing playing';
  }

  row.appendChild(clipEl);
  parent.appendChild(row);
}

export function renderView(root, {
  title,
  fields,
  payload,
  connected,
  lastUpdate,
  editable = false,
  editSession = null,
  editorColumns = {},
  saveState = 'idle',
  saveError = null,
  onStartEdit,
  onStartCreate,
  onCancelEdit,
  onSaveEdit,
}) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'View';
  root.appendChild(titleEl);

  const clipHead = document.createElement('div');
  clipHead.id = 'view-clip-head';
  root.appendChild(clipHead);
  renderViewClipHead(clipHead, payload);

  const matched = payload?.match?.matched === true;
  if (payload && payload.clipName?.trim() && !matched && !editSession) {
    const noMatch = document.createElement('div');
    noMatch.className = editable && onStartCreate ? 'no-match-panel' : 'no-match';

    const message = document.createElement('p');
    message.className = 'no-match';
    message.textContent = 'No confident match — check the cue sheet or clip name.';
    noMatch.appendChild(message);

    if (editable && onStartCreate) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'admin-editor-btn admin-editor-btn--primary';
      addBtn.textContent = 'Add cue row';
      addBtn.addEventListener('click', onStartCreate);
      noMatch.appendChild(addBtn);
    }

    root.appendChild(noMatch);
  }

  const viewEditorColumns = buildViewEditorColumns(fields, editorColumns);
  const fieldLabels = buildFieldLabels(fields);

  if (editSession) {
    renderRowEditorPanel(root, {
      session: editSession,
      editorColumns: viewEditorColumns,
      fieldLabels,
      panelId: 'view-row-panel',
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
    });
  } else if (matched && fields?.length) {
    if (editable && onStartEdit) {
      const editBar = document.createElement('div');
      editBar.className = 'view-edit-bar';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'admin-editor-btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', onStartEdit);
      editBar.appendChild(editBtn);

      root.appendChild(editBar);
    }

    const fieldsWrap = document.createElement('div');
    fieldsWrap.className = 'view-fields-wrap';

    const grid = document.createElement('div');
    grid.className = 'fields';

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (field.type === 'color') {
        const group = [];
        while (i < fields.length && fields[i].type === 'color') {
          group.push(fields[i]);
          i++;
        }
        i--;
        grid.appendChild(renderColorGroup(group, payload));
      } else {
        grid.appendChild(renderTextField(field, payload));
      }
    }

    fieldsWrap.appendChild(grid);
    root.appendChild(fieldsWrap);
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

export function updateViewLiveChrome(root, { payload, connected, lastUpdate, editSession }) {
  const clipHead = root.querySelector('#view-clip-head');
  if (clipHead) renderViewClipHead(clipHead, payload);

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderViewClipHead(parent, payload) {
  parent.innerHTML = '';
  const clipName = payload?.clipName?.trim() || null;
  renderClipNameRow(parent, clipName, payload);
}

function renderTextField(field, payload) {
  const column = field.column;
  const label = field.label ?? column;
  const raw = payload.row?.[column];
  const value = raw == null || String(raw).trim() === '' ? null : String(raw);

  const card = document.createElement('div');
  card.className = 'field';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  if (value) {
    const valueWrap = document.createElement('div');
    valueWrap.className = 'field-value-body';

    const valueBtn = document.createElement('button');
    valueBtn.type = 'button';
    valueBtn.className = 'field-value field-value--clamp';
    valueBtn.textContent = value;
    valueBtn.setAttribute('aria-expanded', 'false');
    valueBtn.title = 'Tap to read full text';
    valueBtn.addEventListener('click', () => openFieldExpand(label, value));
    valueWrap.appendChild(valueBtn);
    card.appendChild(valueWrap);
  } else {
    const valueWrap = document.createElement('div');
    valueWrap.className = 'field-value-body';

    const valueEl = document.createElement('p');
    valueEl.className = 'field-value empty';
    valueEl.textContent = '—';
    valueWrap.appendChild(valueEl);
    card.appendChild(valueWrap);
  }

  return card;
}

function renderColorGroup(fields, payload) {
  const row = document.createElement('div');
  row.className = 'colors-row';

  for (const field of fields) {
    row.appendChild(renderColorField(field, payload));
  }

  return row;
}

function renderColorField(field, payload) {
  const column = field.column;
  const label = field.label ?? column;
  const raw = payload.row?.[column];
  const color = parseRgbCell(raw);

  const card = document.createElement('div');
  card.className = 'field-color';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  if (!color) {
    const empty = document.createElement('p');
    empty.className = 'field-value empty';
    empty.textContent = '—';
    card.appendChild(empty);
    return card;
  }

  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = color.css;
  swatch.setAttribute('aria-label', `${label}: ${color.rgbText}`);
  card.appendChild(swatch);

  const values = document.createElement('div');
  values.className = 'color-values';
  values.appendChild(makeCopyButton('RGB', color.rgbText));
  values.appendChild(makeCopyButton('Hex', color.hex));
  card.appendChild(values);

  return card;
}

function makeCopyButton(kind, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'color-copy';
  btn.title = `Copy ${kind}`;

  const kindEl = document.createElement('span');
  kindEl.className = 'color-copy-kind';
  kindEl.textContent = kind;
  btn.appendChild(kindEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'color-copy-value';
  valueEl.textContent = text;
  btn.appendChild(valueEl);

  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      window.setTimeout(() => btn.classList.remove('copied'), 1200);
    } catch {
      btn.classList.add('copy-failed');
      window.setTimeout(() => btn.classList.remove('copy-failed'), 1200);
    }
  });

  return btn;
}

function updateStatusBar({ connected, lastUpdate, payload, simulated = null }) {
  const bar = document.getElementById('status-bar');
  if (!bar) return;

  bar.classList.toggle('connected', connected);

  const connText = bar.querySelector('[data-role="connection"]');
  if (connText) connText.textContent = connected ? 'Connected' : 'Reconnecting…';

  const updateText = bar.querySelector('[data-role="last-update"]');
  if (updateText) {
    if (lastUpdate) {
      updateText.textContent = lastUpdate.toLocaleTimeString();
      updateText.title = `Last cue update: ${lastUpdate.toLocaleString()}`;
    } else {
      updateText.textContent = '—';
      updateText.title = 'Last cue update';
    }
  }

  const simPill = document.getElementById('sim-pill');
  const stalePill = document.getElementById('stale-pill');
  const simOn = simulated != null ? Boolean(simulated) : Boolean(payload?.simulated);
  const staleOn = Boolean(payload?.stale);
  if (simPill) simPill.hidden = !simOn;
  if (stalePill) stalePill.hidden = !staleOn;
  bar.classList.toggle('status-bar--alert', simOn || staleOn);
}

export function setConnectionState(connected, lastUpdate, payload, simulated = null) {
  updateStatusBar({ connected, lastUpdate, payload, simulated });
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return '—';
  return `${Math.round(confidence * 100)}%`;
}

function formatTempo(tempo) {
  if (tempo == null || Number.isNaN(Number(tempo))) return '—';
  const n = Number(tempo);
  return Number.isInteger(n) ? `${n} BPM` : `${n.toFixed(1)} BPM`;
}

function formatBeat(beat) {
  if (beat == null || Number.isNaN(Number(beat))) return '—';
  return String(beat);
}

function addStat(parent, label, value, { warn = false } = {}) {
  const card = document.createElement('div');
  card.className = 'stat' + (warn ? ' warn' : '');

  const labelEl = document.createElement('p');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement('p');
  valueEl.className = 'stat-value';
  valueEl.textContent = value ?? '—';
  card.appendChild(valueEl);

  parent.appendChild(card);
}

export function renderAdmin(root, {
  title,
  payload,
  status,
  connected,
  lastUpdate,
  editSession = null,
  editorColumns = {},
  saveState = 'idle',
  saveError = null,
  onStartEdit,
  onStartCreate,
  onCancelEdit,
  onSaveEdit,
}) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'Admin';
  root.appendChild(titleEl);

  const clipHead = document.createElement('div');
  clipHead.id = 'admin-clip-head';
  root.appendChild(clipHead);
  renderAdminClipHead(clipHead, payload);

  const stats = document.createElement('div');
  stats.id = 'admin-stats';
  stats.className = 'admin-stats';
  root.appendChild(stats);
  renderAdminStats(stats, payload, status);

  if (payload && payload.clipName?.trim() && payload.match?.matched !== true && !editSession) {
    const noMatch = document.createElement('div');
    noMatch.className = 'no-match-panel';

    const message = document.createElement('p');
    message.className = 'no-match';
    message.textContent = 'No confident match — check the cue sheet or clip name.';
    noMatch.appendChild(message);

    if (onStartCreate) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'admin-editor-btn admin-editor-btn--primary';
      addBtn.textContent = 'Add cue row';
      addBtn.addEventListener('click', onStartCreate);
      noMatch.appendChild(addBtn);
    }

    root.appendChild(noMatch);
  }

  if (editSession) {
    renderRowEditorPanel(root, {
      session: editSession,
      editorColumns,
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
    });
  } else if (payload?.match?.matched === true && payload.row && onStartEdit) {
    renderReadOnlyRowPanel(root, { payload, onStartEdit });
  } else if (payload?.match?.matched === true && payload.row) {
    renderReadOnlyRowPanel(root, { payload, onStartEdit: () => {} });
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

export function updateAdminLiveChrome(root, { payload, status, connected, lastUpdate, editSession }) {
  const clipHead = root.querySelector('#admin-clip-head');
  if (clipHead) renderAdminClipHead(clipHead, payload);

  const stats = root.querySelector('#admin-stats');
  if (stats) renderAdminStats(stats, payload, status);

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderAdminClipHead(parent, payload) {
  parent.innerHTML = '';
  const clipName = payload?.clipName?.trim() || null;
  renderClipNameRow(parent, clipName, payload);
}

function renderAdminStats(parent, payload, status) {
  parent.innerHTML = '';

  const matched = payload?.match?.matched === true;
  const clipName = payload?.clipName?.trim() || null;
  addStat(parent, 'Match', matched ? 'Yes' : 'No', { warn: payload && clipName && !matched });
  addStat(parent, 'Confidence', formatConfidence(payload?.match?.confidence));
  addStat(parent, 'Row ID', payload?.match?.rowId ?? '—');
  addStat(parent, 'Matched value', payload?.match?.matchedValue ?? '—');
  addStat(parent, 'Via alias', payload?.match?.viaAlias ? 'Yes' : 'No');
  addStat(parent, 'Tempo', formatTempo(payload?.tempo));
  addStat(parent, 'Beat', formatBeat(payload?.beat));
  addStat(parent, 'Last sync', formatTimestamp(payload?.syncedAt));
  addStat(parent, 'Cache', payload?.stale ? 'Stale (offline)' : 'Fresh', { warn: payload?.stale });
  addStat(parent, 'Connected views', String(status?.connectedViews ?? 0));
}

export { captureEditSession };
