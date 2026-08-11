// Shared view rendering (spec §9.4). Maps CuePayload + field config → DOM.

import { parseRgbCell } from './color-parse.js';
import {
  getFieldValue,
  fieldLabel,
  isLiveField,
  resolveFieldDisplay,
  groupFieldsForLayout,
  resolveFieldsLayoutMode,
} from './field-display.js';
import {
  captureEditSession,
  renderRowEditorPanel,
  renderOperatorRowEditorPanel,
  renderReadOnlyRowPanel,
  updateEditContextBanner,
  buildViewEditorColumns,
  buildFieldLabels,
} from './admin-row-editor.js';
import { renderAliasPanel } from './alias-panel.js';
import {
  hasPlayingClips,
  resolveHeroDisplay,
  renderPlayingClipsStrip,
} from './playing-clips-strip.js';

/** @type {HTMLElement | null} */
let fieldExpandOverlay = null;

function renderNoMatchActions(parent, { onStartCreate, onStartAlias, hideAlias = false }) {
  if (!onStartCreate && (!onStartAlias || hideAlias)) return;

  const actions = document.createElement('div');
  actions.className = 'no-match-actions';

  if (onStartCreate) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'admin-editor-btn admin-editor-btn--primary';
    addBtn.textContent = 'Add cue row';
    addBtn.addEventListener('click', onStartCreate);
    actions.appendChild(addBtn);
  }

  if (onStartAlias && !hideAlias) {
    const aliasBtn = document.createElement('button');
    aliasBtn.type = 'button';
    aliasBtn.className = 'admin-editor-btn';
    aliasBtn.textContent = 'Add as alias';
    aliasBtn.addEventListener('click', onStartAlias);
    actions.appendChild(aliasBtn);
  }

  parent.appendChild(actions);
}

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

function renderHeroRow(parent, heroText, payload, { empty = false } = {}) {
  const row = document.createElement('div');
  row.className = 'clip-head' + (isLaunching(payload) ? ' clip-head--launching' : '');

  const clipEl = document.createElement('p');
  clipEl.className = 'clip-name' + (empty ? ' empty-clip' : '');

  if (heroText && !empty) {
    const text = document.createElement('span');
    text.className = 'clip-name-text';
    text.textContent = heroText;
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
    clipEl.textContent = heroText || 'Nothing playing';
  }

  row.appendChild(clipEl);
  parent.appendChild(row);
}

function renderNoMatchPanel(root, {
  payload,
  editable,
  aliasSession,
  createSession,
  onStartCreate,
  onStartAlias,
}) {
  const playing = hasPlayingClips(payload);
  const noMatch = document.createElement('div');
  noMatch.className = editable ? 'no-match-panel' : 'no-match';

  const message = document.createElement('p');
  message.className = 'no-match';
  message.textContent = playing
    ? 'No confident match — link a playing clip to the cue sheet below.'
    : 'No confident match — check the cue sheet or clip name.';
  noMatch.appendChild(message);

  if (playing) {
    renderPlayingClipsStrip(noMatch, payload, {
      onStartAlias: editable ? onStartAlias : undefined,
      onStartCreate: editable ? onStartCreate : undefined,
      aliasSession,
      createSession,
      showDeckNames: true,
    });
  } else if (editable && (onStartCreate || onStartAlias)) {
    renderNoMatchActions(noMatch, {
      onStartCreate,
      onStartAlias,
    });
  }

  root.appendChild(noMatch);
}

export function renderView(root, {
  title,
  fields,
  payload,
  connected,
  lastUpdate,
  matchColumn = null,
  aliasColumn = null,
  editable = false,
  editSession = null,
  aliasSession = null,
  aliasPanel = null,
  editorColumns = {},
  saveState = 'idle',
  saveError = null,
  onStartEdit,
  onStartCreate,
  onStartAlias,
  onCancelEdit,
  onSaveEdit,
}) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'View';
  root.appendChild(titleEl);

  const matched = payload?.match?.matched === true;
  const busy = Boolean(editSession || aliasSession);

  const clipHead = document.createElement('div');
  clipHead.id = 'view-clip-head';
  root.appendChild(clipHead);
  renderViewClipHead(clipHead, payload, matchColumn, { busy });

  const showNoMatch = payload && !matched && !busy
    && (hasPlayingClips(payload) || payload.clipName?.trim());

  if (showNoMatch) {
    renderNoMatchPanel(root, {
      payload,
      editable,
      aliasSession,
      createSession: editSession?.mode === 'create' ? editSession : null,
      onStartCreate,
      onStartAlias,
    });
  }

  const viewEditorColumns = buildViewEditorColumns(fields, editorColumns);
  if (matchColumn && !viewEditorColumns[matchColumn]) {
    viewEditorColumns[matchColumn] = { type: 'text' };
  }
  if (aliasColumn && !viewEditorColumns[aliasColumn]) {
    viewEditorColumns[aliasColumn] = { type: 'text' };
  }
  const fieldLabels = {
    ...buildFieldLabels(fields),
    ...(matchColumn ? { [matchColumn]: matchColumn } : {}),
    ...(aliasColumn ? { [aliasColumn]: aliasColumn } : {}),
  };

  if (aliasSession && aliasPanel) {
    renderAliasPanel(root, aliasPanel);
  } else if (editSession) {
    renderOperatorRowEditorPanel(root, {
      session: editSession,
      fields,
      matchColumn,
      aliasColumn,
      editorColumns: viewEditorColumns,
      fieldLabels,
      panelId: 'view-row-panel',
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
    });
  } else if (!busy && fields?.length) {
    const visibleFields = matched
      ? fields
      : fields.filter((f) => isLiveField(f));

    if (matched && editable && onStartEdit) {
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

    if (visibleFields.length) {
      root.appendChild(renderFieldsGrid(visibleFields, payload));
    }
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

export function updateViewLiveChrome(root, { payload, connected, lastUpdate, editSession, matchColumn = null }) {
  const clipHead = root.querySelector('#view-clip-head');
  const busy = Boolean(editSession);
  if (clipHead) renderViewClipHead(clipHead, payload, matchColumn, { busy });

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderViewClipHead(parent, payload, matchColumn = null, { busy = false } = {}) {
  parent.innerHTML = '';
  const hero = resolveHeroDisplay(payload, matchColumn, { busy });
  if (!hero.showHero) return;
  renderHeroRow(parent, hero.text, payload, { empty: hero.empty });
}

function renderFieldsGrid(fields, payload) {
  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'view-fields-wrap';

  const layoutMode = resolveFieldsLayoutMode(fields);
  const grid = document.createElement('div');
  grid.className = `fields fields-${layoutMode}` + (fields.length > 4 ? ' fields-many' : '');

  if (layoutMode === 'strip') {
    grid.style.setProperty('--strip-cols', String(fields.length));
    for (const field of fields) {
      if (field.type === 'color') {
        grid.appendChild(renderColorField(field, payload));
      } else {
        grid.appendChild(renderTextField(field, payload, null, layoutMode));
      }
    }
  } else {
    for (const row of groupFieldsForLayout(fields, payload)) {
      if (row.type === 'colors') {
        grid.appendChild(renderColorGroup(row.fields, payload));
      } else if (row.type === 'note') {
        grid.appendChild(renderTextField(row.field, payload, 'note'));
      } else {
        const rowEl = document.createElement('div');
        rowEl.className = 'fields-row';
        for (const item of row.items) {
          rowEl.appendChild(renderTextField(item.field, payload, item.display));
        }
        grid.appendChild(rowEl);
      }
    }
  }

  fieldsWrap.appendChild(grid);
  return fieldsWrap;
}

function renderTextField(field, payload, displayHint, layoutMode = 'hero') {
  const label = fieldLabel(field);
  const value = getFieldValue(field, payload);
  const display = displayHint ?? resolveFieldDisplay(field, value, { layout: layoutMode });

  const card = document.createElement('div');
  card.className = `field field--${display}`;
  if (layoutMode === 'strip' && display === 'token' && value) {
    card.style.setProperty('--token-chars', String([...value.trim()].length));
  }

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueWrap = document.createElement('div');
  valueWrap.className = 'field-value-body';

  if (value) {
    if (display === 'token') {
      const valueEl = document.createElement('p');
      valueEl.className = 'field-value';
      valueEl.textContent = value;
      valueWrap.appendChild(valueEl);
    } else {
      const valueBtn = document.createElement('button');
      valueBtn.type = 'button';
      valueBtn.className = 'field-value field-value--clamp';
      valueBtn.textContent = value;
      valueBtn.setAttribute('aria-expanded', 'false');
      valueBtn.title = 'Tap to read full text';
      valueBtn.addEventListener('click', () => openFieldExpand(label, value));
      valueWrap.appendChild(valueBtn);
    }
  } else {
    const valueEl = document.createElement('p');
    valueEl.className = 'field-value empty';
    valueEl.textContent = '—';
    valueWrap.appendChild(valueEl);
  }

  card.appendChild(valueWrap);
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
  const label = fieldLabel(field);
  const raw = payload.row?.[column];
  const color = parseRgbCell(raw);

  const card = document.createElement('div');
  card.className = 'field field-color field--color';

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

  const body = document.createElement('div');
  body.className = 'color-body';

  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = color.css;
  swatch.setAttribute('aria-label', `${label}: ${color.rgbText}`);
  body.appendChild(swatch);

  const values = document.createElement('div');
  values.className = 'color-values';
  values.appendChild(makeCopyButton('RGB', color.rgbText));
  values.appendChild(makeCopyButton('Hex', color.hex));
  body.appendChild(values);

  card.appendChild(body);

  return card;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // HTTP / permission failures — fall through to execCommand.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    if (!document.execCommand('copy')) {
      throw new Error('copy failed');
    }
  } finally {
    document.body.removeChild(textarea);
  }
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
      await copyTextToClipboard(text);
      btn.classList.add('copied');
      window.setTimeout(() => btn.classList.remove('copied'), 1200);
    } catch {
      btn.classList.add('copy-failed');
      window.setTimeout(() => btn.classList.remove('copy-failed'), 1200);
    }
  });

  return btn;
}

function resolveConnectionState(connected, payload, simulated) {
  if (!connected) {
    return { text: 'Reconnecting…', mode: 'ws-down' };
  }
  if (!simulated && payload?.ingestLive === false) {
    return { text: 'Stale', mode: 'ingest-stale' };
  }
  return { text: 'Connected', mode: 'connected' };
}

function updateStatusBar({ connected, lastUpdate, payload, simulated = null }) {
  const bar = document.getElementById('status-bar');
  if (!bar) return;

  const simOn = simulated != null ? Boolean(simulated) : Boolean(payload?.simulated);
  const { text, mode } = resolveConnectionState(connected, payload, simOn);

  bar.classList.toggle('connected', mode === 'connected');
  bar.classList.toggle('ingest-stale', mode === 'ingest-stale');
  bar.classList.toggle('ws-down', mode === 'ws-down');

  const connText = bar.querySelector('[data-role="connection"]');
  if (connText) connText.textContent = text;

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
  const staleOn = Boolean(payload?.stale);
  if (simPill) simPill.hidden = !simOn;
  if (stalePill) stalePill.hidden = !staleOn;
  bar.classList.toggle('status-bar--alert', simOn || staleOn || mode === 'ingest-stale');
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

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return null;
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString();
}

function formatTimecodeStat(timecodeStatus) {
  if (!timecodeStatus?.enabled) {
    return { value: 'Disabled', warn: false };
  }
  const tc = timecodeStatus.timecode;
  if (!tc?.display) {
    return { value: 'No signal', warn: true };
  }
  const rate = tc.typeLabel && tc.fps != null ? `${tc.typeLabel} ${tc.fps} fps` : tc.typeLabel ?? '';
  const suffix = rate ? ` (${rate})` : '';
  if (timecodeStatus.live) {
    return { value: `${tc.display}${suffix}`, warn: false };
  }
  return { value: `${tc.display}${suffix} · stale`, warn: true };
}

function cueTrackStat(ableton) {
  if (!ableton) return { value: '—', warn: false };
  const configured = ableton.cueTrackConfigured;
  if (configured == null || configured === '') {
    return { value: 'Not used (bestMatch)', warn: false };
  }
  if (ableton.cueTrackFound == null) {
    return { value: `Waiting… (${configured})`, warn: false };
  }
  if (ableton.cueTrackFound) {
    return { value: `Found (${configured})`, warn: false };
  }
  return { value: `Missing (${configured})`, warn: true };
}

function sessionTracksStat(ableton) {
  if (!ableton) return { value: '—', warn: false };
  if (!ableton.live && ableton.trackNames == null) {
    return { value: 'No session yet', warn: true };
  }
  if (ableton.trackNames == null) {
    return { value: 'Waiting for tracks…', warn: false };
  }
  if (ableton.trackNames.length === 0) {
    return { value: '(empty set)', warn: true };
  }
  const list = ableton.trackNames.join(', ');
  return {
    value: list.length > 80 ? `${ableton.trackNames.length} tracks` : list,
    warn: false,
    title: list,
  };
}

function addStat(parent, label, value, { warn = false, title = null } = {}) {
  const card = document.createElement('div');
  card.className = 'stat' + (warn ? ' warn' : '');
  if (title) card.title = title;

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
  matchColumn = null,
  aliasColumn = null,
  editSession = null,
  aliasSession = null,
  aliasPanel = null,
  editorColumns = {},
  saveState = 'idle',
  saveError = null,
  onStartEdit,
  onStartCreate,
  onStartAlias,
  onCancelEdit,
  onSaveEdit,
}) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'Admin';
  root.appendChild(titleEl);

  const busy = Boolean(editSession || aliasSession);

  const clipHead = document.createElement('div');
  clipHead.id = 'admin-clip-head';
  root.appendChild(clipHead);
  renderAdminClipHead(clipHead, payload, matchColumn, { busy });

  const stats = document.createElement('div');
  stats.id = 'admin-stats';
  stats.className = 'admin-stats';
  root.appendChild(stats);
  renderAdminStats(stats, payload, status);

  const matched = payload?.match?.matched === true;
  const showNoMatch = payload && !matched && !busy
    && (hasPlayingClips(payload) || payload.clipName?.trim());

  if (showNoMatch) {
    renderNoMatchPanel(root, {
      payload,
      editable: true,
      aliasSession,
      createSession: editSession?.mode === 'create' ? editSession : null,
      onStartCreate,
      onStartAlias,
    });
  }

  if (aliasSession && aliasPanel) {
    renderAliasPanel(root, aliasPanel);
  } else if (editSession) {
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

export function updateAdminLiveChrome(root, { payload, status, connected, lastUpdate, editSession, matchColumn = null }) {
  const clipHead = root.querySelector('#admin-clip-head');
  const busy = Boolean(editSession);
  if (clipHead) renderAdminClipHead(clipHead, payload, matchColumn, { busy });

  const stats = root.querySelector('#admin-stats');
  if (stats) renderAdminStats(stats, payload, status);

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderAdminClipHead(parent, payload, matchColumn = null, { busy = false } = {}) {
  parent.innerHTML = '';
  const hero = resolveHeroDisplay(payload, matchColumn, { busy });
  if (!hero.showHero) {
    return;
  }
  renderHeroRow(parent, hero.text, payload, { empty: hero.empty });

  const clipName = payload?.clipName?.trim();
  const matched = payload?.match?.matched === true;
  if (clipName && matched && hero.text !== clipName) {
    const sub = document.createElement('p');
    sub.className = 'clip-head-sub';
    sub.textContent = `Clip: ${clipName}`;
    parent.appendChild(sub);
  }
}

function renderAdminStats(parent, payload, status) {
  parent.innerHTML = '';

  const matched = payload?.match?.matched === true;
  const clipName = payload?.clipName?.trim() || null;
  const playing = hasPlayingClips(payload);
  addStat(parent, 'Match', matched ? 'Yes' : 'No', { warn: payload && !matched && (playing || clipName) });
  addStat(parent, 'Confidence', formatConfidence(payload?.match?.confidence));
  addStat(parent, 'Row ID', payload?.match?.rowId ?? '—');
  addStat(parent, 'Matched value', payload?.match?.matchedValue ?? '—');
  addStat(parent, 'Via alias', payload?.match?.viaAlias ? 'Yes' : 'No');
  addStat(parent, 'Tempo', formatTempo(payload?.tempo));
  addStat(parent, 'Beat', formatBeat(payload?.beat));
  addStat(parent, 'Last sync', formatTimestamp(payload?.syncedAt));
  addStat(parent, 'Cache', payload?.stale ? 'Stale (offline)' : 'Fresh', { warn: payload?.stale });
  {
    const tc = formatTimecodeStat(status?.timecode);
    addStat(parent, 'Timecode', tc.value, { warn: tc.warn });
  }
  if (payload?.simulated !== true) {
    const ableton = payload?.ableton ?? status?.ingest ?? null;
    const live = ableton?.live ?? payload?.ingestLive !== false;
    const seen = formatLastSeen(ableton?.lastSeenAt);
    addStat(
      parent,
      'Ableton OSC',
      live ? (seen ? `Live · ${seen}` : 'Live') : 'No signal',
      { warn: !live },
    );
    const cue = cueTrackStat(ableton);
    addStat(parent, 'Cue track', cue.value, { warn: cue.warn });
    const tracks = sessionTracksStat(ableton);
    addStat(parent, 'Tracks in set', tracks.value, { warn: tracks.warn, title: tracks.title });
  }
  addStat(parent, 'Connected views', String(status?.connectedViews ?? 0));
}

export { captureEditSession };
