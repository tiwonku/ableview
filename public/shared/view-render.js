// Shared view rendering (spec §9.4). Maps CuePayload + field config → DOM.

import { applyColorSwatchStyle, parseRgbCell } from './color-parse.js';
import { renderLiveColorHost, DEFAULT_LIVE_COLOR_COLUMNS } from './live-color-overlay.js';
import { parseImageCell } from './image-parse.js';
import { closeColorPicker } from './color-picker.js';
import { flashableColorColumns } from './flash-look.js';
import {
  getFieldValue,
  fieldLabel,
  resolveFieldDisplay,
  groupFieldsForLayout,
  resolveFieldsLayoutMode,
  isCamelotField,
} from './field-display.js';
import { renderCamelotField } from './camelot-render.js';
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
import { renderPinPanel } from './pin-panel.js';
import {
  hasPlayingClips,
  hasArrangementPlayback,
  resolveHeroDisplay,
  renderPlayingClipsStrip,
  resolveCuePane,
  lastPanePayload,
} from './playing-clips-strip.js';
import { prependDopeButton } from './moment-controls.js';
import { copyTextToClipboard } from './clipboard.js';
import { buildDashboardZones } from './admin-dashboard.js';
import { renderSceneBanner, renderSessionTracks } from './session-tracks.js';

const TRANSPORT_PLAY_ICON = `<svg class="transport-indicator-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.5v13l11-6.5L8 5.5z"/></svg>`;
const TRANSPORT_PAUSE_ICON = `<svg class="transport-indicator-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 5h3.5v14H7V5zm6.5 0H17v14h-3.5V5z"/></svg>`;
const EDIT_ICON = `<svg class="view-edit-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const SET_ICON = `<svg class="view-edit-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;

/** @type {HTMLElement | null} */
let fieldExpandOverlay = null;

function renderNoMatchActions(parent, { onStartCreate, onStartAlias, onStartPin, onPinLast, hideAlias = false }) {
  if (!onStartCreate && (!onStartAlias || hideAlias) && !onStartPin && !onPinLast) return;

  const actions = document.createElement('div');
  actions.className = 'no-match-actions';

  if (onPinLast) {
    const lastBtn = document.createElement('button');
    lastBtn.type = 'button';
    lastBtn.className = 'admin-editor-btn admin-editor-btn--primary';
    lastBtn.textContent = 'Pin last cue';
    lastBtn.addEventListener('click', () => onPinLast());
    actions.appendChild(lastBtn);
  }

  if (onStartPin) {
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'admin-editor-btn';
    pinBtn.textContent = 'Pin cue';
    pinBtn.addEventListener('click', () => onStartPin());
    actions.appendChild(pinBtn);
  }

  if (onStartCreate) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'admin-editor-btn admin-editor-btn--primary';
    addBtn.textContent = 'Add cue row';
    addBtn.addEventListener('click', () => onStartCreate());
    actions.appendChild(addBtn);
  }

  if (onStartAlias && !hideAlias) {
    const aliasBtn = document.createElement('button');
    aliasBtn.type = 'button';
    aliasBtn.className = 'admin-editor-btn';
    aliasBtn.textContent = 'Add as alias';
    aliasBtn.addEventListener('click', () => onStartAlias());
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

function renderHeroRow(parent, heroText, payload, {
  empty = false,
  noMatch = false,
  lastMatched = false,
  pinned = false,
  launching = isLaunching(payload),
} = {}) {
  const row = document.createElement('div');
  row.className = 'clip-head' + (launching ? ' clip-head--launching' : '');

  const clipEl = document.createElement('p');
  clipEl.className = 'clip-name'
    + (empty ? ' empty-clip' : '')
    + (noMatch ? ' clip-name--nomatch' : '')
    + (lastMatched ? ' clip-name--last-matched' : '')
    + (pinned ? ' clip-name--pinned' : '');

  if (heroText && !empty) {
    if (lastMatched || pinned) {
      const kicker = document.createElement('span');
      kicker.className = 'clip-name-kicker';
      kicker.textContent = pinned ? 'Pinned' : 'Last matched';
      clipEl.appendChild(kicker);
      clipEl.setAttribute('aria-label', pinned ? `Pinned: ${heroText}` : `Last matched: ${heroText}`);
    }

    const text = document.createElement('span');
    text.className = 'clip-name-text';
    text.textContent = heroText;
    clipEl.appendChild(text);

    if (launching) {
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
  onStartPin,
  onPinLast,
}) {
  const playing = hasPlayingClips(payload);
  const noMatch = document.createElement('div');
  noMatch.className = editable ? 'no-match-panel' : 'no-match';
  if (playing) noMatch.classList.add('no-match--clips');

  // Operator views already show a hero "No Match"; keep the longer prompt on admin.
  if (editable || !playing) {
    const message = document.createElement('p');
    message.className = 'no-match';
    if (playing) {
      message.textContent = 'No confident match — link a playing clip to the cue sheet below.';
    } else {
      message.textContent = 'No confident match — check the cue sheet or clip name.';
    }
    noMatch.appendChild(message);
  }

  if (playing) {
    renderPlayingClipsStrip(noMatch, payload, {
      onStartAlias: editable ? onStartAlias : undefined,
      onStartCreate: editable ? onStartCreate : undefined,
      aliasSession,
      createSession,
      showDeckNames: true,
    });
  }

  const pinLast = onPinLast && payload?.lastMatched?.rowId ? onPinLast : undefined;
  if (playing) {
    if (onStartPin || pinLast) {
      renderNoMatchActions(noMatch, { onStartPin, onPinLast: pinLast });
    }
  } else if (onStartPin || pinLast || (editable && (onStartCreate || onStartAlias))) {
    renderNoMatchActions(noMatch, {
      onStartCreate: editable ? onStartCreate : undefined,
      onStartAlias: editable ? onStartAlias : undefined,
      onStartPin,
      onPinLast: pinLast,
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
  cuePane = 'current',
  onCuePaneChange,
  pinSession = null,
  pinPanel = null,
  onStartPin,
  onPinLast,
  onClearPin,
  getMomentWho = null,
  onStartFlashLook,
  flashLookReady = false,
  flashLookTitle = '',
  liveColorColumns = DEFAULT_LIVE_COLOR_COLUMNS,
}) {
  closeColorPicker();
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'View';
  root.appendChild(titleEl);

  const matched = payload?.match?.matched === true;
  const pinned = payload?.match?.viaOverride === true;
  const busy = Boolean(editSession || aliasSession || pinSession);
  const pane = resolveCuePane(payload, cuePane, { busy });

  const clipRow = document.createElement('div');
  clipRow.className = 'clip-head-row';

  const clipHead = document.createElement('div');
  clipHead.id = 'view-clip-head';
  clipRow.appendChild(clipHead);
  renderViewClipHead(clipHead, payload, matchColumn, { busy, editSession, cuePane: pane ?? cuePane });

  const editActions = renderViewEditActions({
    editSession,
    matched,
    editable,
    saveState,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    cuePane: pane,
    onCuePaneChange,
    onClearPin: pinned && !busy ? onClearPin : undefined,
    onStartPin: matched && !busy ? onStartPin : undefined,
    getMomentWho,
    onStartFlashLook: !busy ? onStartFlashLook : undefined,
    flashLookReady,
    flashLookTitle,
    fields,
    liveColorColumns,
  });
  if (editActions) clipRow.appendChild(editActions);
  root.appendChild(clipRow);

  const showNoMatch = payload && !matched && !busy
    && (hasPlayingClips(payload) || payload.clipName?.trim());
  const showLastFields = showNoMatch && pane === 'last';

  if (showNoMatch && !showLastFields) {
    renderNoMatchPanel(root, {
      payload,
      editable,
      aliasSession,
      createSession: editSession?.mode === 'create' ? editSession : null,
      onStartCreate,
      onStartAlias,
      onStartPin,
      onPinLast,
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

  if (pinSession && pinPanel) {
    renderPinPanel(root, pinPanel);
  } else if (aliasSession && aliasPanel) {
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
    if (matched) {
      root.appendChild(renderFieldsGrid(fields, payload, {
        onPickColor: editable && onStartEdit
          ? (column) => onStartEdit(column)
          : undefined,
      }));
    } else if (showLastFields) {
      root.appendChild(renderLastMatchedFields(fields, payload, { onPinLast, onStartPin }));
    }
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

export function updateViewLiveChrome(root, {
  payload,
  connected,
  lastUpdate,
  editSession,
  matchColumn = null,
  cuePane = 'current',
}) {
  const clipHead = root.querySelector('#view-clip-head');
  const busy = Boolean(editSession);
  if (clipHead) renderViewClipHead(clipHead, payload, matchColumn, { busy, editSession, cuePane });

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function frozenEditHeroText(editSession, matchColumn) {
  if (matchColumn) {
    const fromRow = String(editSession.row?.[matchColumn] ?? '').trim();
    if (fromRow) return fromRow;
  }
  const matched = String(editSession.matchedValueAtEdit ?? '').trim();
  if (matched) return matched;
  const clip = String(editSession.clipNameAtEdit ?? '').trim();
  if (clip) return clip;
  return editSession.mode === 'create' ? 'New cue' : 'Editing';
}

function renderViewClipHead(parent, payload, matchColumn = null, {
  busy = false,
  editSession = null,
  cuePane = 'current',
} = {}) {
  parent.innerHTML = '';
  if (editSession) {
    renderHeroRow(parent, frozenEditHeroText(editSession, matchColumn), payload, {
      launching: false,
    });
    return;
  }
  const hero = resolveHeroDisplay(payload, matchColumn, { busy, noMatchHero: true, cuePane });
  if (!hero.showHero) return;
  renderHeroRow(parent, hero.text, payload, {
    empty: hero.empty,
    noMatch: hero.noMatch,
    lastMatched: hero.lastMatched,
    pinned: hero.pinned,
  });
}

function renderLastMatchedFields(fields, payload, { onPinLast, onStartPin } = {}) {
  const panel = document.createElement('div');
  panel.className = 'no-match-panel no-match-panel--last-fields';
  panel.setAttribute('aria-label', 'Last matched cue');
  const canPinThis = onPinLast && payload?.lastMatched?.rowId;
  if (canPinThis || onStartPin) {
    const actions = document.createElement('div');
    actions.className = 'last-fields-actions';
    if (canPinThis) {
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'admin-editor-btn admin-editor-btn--primary';
      pinBtn.textContent = 'Pin this cue';
      pinBtn.addEventListener('click', () => onPinLast());
      actions.appendChild(pinBtn);
    }
    if (onStartPin) {
      const otherBtn = document.createElement('button');
      otherBtn.type = 'button';
      otherBtn.className = canPinThis ? 'admin-editor-btn' : 'admin-editor-btn admin-editor-btn--primary';
      otherBtn.textContent = 'Pin a different cue';
      otherBtn.addEventListener('click', () => onStartPin());
      actions.appendChild(otherBtn);
    }
    panel.appendChild(actions);
  }
  panel.appendChild(renderFieldsGrid(fields, lastPanePayload(payload)));
  return panel;
}

function renderCuePaneToggle(cuePane, onCuePaneChange) {
  const group = document.createElement('div');
  group.className = 'cue-pane-toggle';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Cue pane');

  for (const id of ['last', 'current']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cue-pane-btn cue-pane-btn--${id}`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', cuePane === id ? 'true' : 'false');
    btn.textContent = id === 'last' ? 'Last' : 'Current';
    btn.addEventListener('click', () => {
      if (cuePane !== id) onCuePaneChange(id);
    });
    group.appendChild(btn);
  }

  return group;
}

function appendLookWriteButton(actions, { onStartFlashLook, flashLookReady = false, flashLookTitle = '' }) {
  const flashBtn = document.createElement('button');
  flashBtn.type = 'button';
  flashBtn.className = 'view-edit-btn view-edit-btn--flash';
  flashBtn.dataset.role = 'flash-look';
  flashBtn.textContent = 'Flash';
  flashBtn.disabled = !flashLookReady;
  flashBtn.title = flashLookTitle || 'Write GrandMA colors to this cue';
  flashBtn.addEventListener('click', () => {
    if (flashBtn.disabled) return;
    onStartFlashLook();
  });
  actions.appendChild(flashBtn);
}

function renderViewEditActions({
  editSession,
  matched,
  editable,
  saveState = 'idle',
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  cuePane = null,
  onCuePaneChange,
  onClearPin,
  onStartPin,
  getMomentWho = null,
  onStartFlashLook,
  flashLookReady = false,
  flashLookTitle = '',
  fields = [],
  liveColorColumns = DEFAULT_LIVE_COLOR_COLUMNS,
}) {
  const showSave = Boolean(editSession && onCancelEdit && onSaveEdit);
  const showEdit = !editSession && matched && editable && onStartEdit;
  const showToggle = !editSession && Boolean(cuePane) && typeof onCuePaneChange === 'function';
  const showClear = !editSession && typeof onClearPin === 'function';
  const showChange = !editSession && typeof onStartPin === 'function';
  const showDope = getMomentWho != null;
  const showFlash = !editSession
    && matched
    && editable
    && typeof onStartFlashLook === 'function'
    && flashableColorColumns(fields, liveColorColumns).length > 0;
  if (!showSave && !showEdit && !showToggle && !showClear && !showChange && !showDope && !showFlash) return null;

  const actions = document.createElement('div');
  actions.className = 'view-edit-actions';
  if (showDope) prependDopeButton(actions, getMomentWho);

  if (showSave) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'view-edit-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.disabled = saveState === 'saving';
    cancelBtn.addEventListener('click', onCancelEdit);
    actions.appendChild(cancelBtn);

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'view-edit-btn view-edit-btn--primary';
    saveBtn.textContent = saveState === 'saving' ? 'Saving…' : 'Save';
    saveBtn.disabled = saveState === 'saving';
    saveBtn.addEventListener('click', () => {
      const section = actions.closest('#app')?.querySelector('#view-row-panel')
        ?? document.getElementById('view-row-panel');
      if (section) onSaveEdit(section);
    });
    actions.appendChild(saveBtn);
    return actions;
  }

  if (showToggle) {
    actions.appendChild(renderCuePaneToggle(cuePane, onCuePaneChange));
    return actions;
  }

  if (showFlash) {
    appendLookWriteButton(actions, { onStartFlashLook, flashLookReady, flashLookTitle });
  }

  if (showChange) {
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'view-edit-btn';
    changeBtn.textContent = 'Change cue';
    changeBtn.addEventListener('click', onStartPin);
    actions.appendChild(changeBtn);
  }

  if (showClear) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'view-edit-btn view-edit-btn--unpin';
    clearBtn.textContent = 'Clear pin';
    clearBtn.addEventListener('click', onClearPin);
    actions.appendChild(clearBtn);
  }

  if (showEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'view-edit-btn view-edit-btn--edit';
    editBtn.innerHTML = `${EDIT_ICON}<span>Edit</span>`;
    editBtn.addEventListener('click', onStartEdit);
    actions.appendChild(editBtn);
  }
  return actions;
}

function renderFieldsGrid(fields, payload, { onPickColor } = {}) {
  const fieldsWrap = document.createElement('div');
  fieldsWrap.className = 'view-fields-wrap';

  const layoutMode = resolveFieldsLayoutMode(fields);
  const grid = document.createElement('div');
  grid.className = `fields fields-${layoutMode}` + (fields.length > 4 ? ' fields-many' : '');

  if (layoutMode === 'strip') {
    grid.style.setProperty('--strip-cols', String(fields.length));
    for (const field of fields) {
      if (field.type === 'color') {
        grid.appendChild(renderColorField(field, payload, { onPickColor }));
      } else if (field.type === 'image') {
        grid.appendChild(renderImageField(field, payload));
      } else if (isCamelotField(field)) {
        grid.appendChild(renderCamelotField(field, payload));
      } else {
        grid.appendChild(renderTextField(field, payload, null, layoutMode));
      }
    }
  } else {
    for (const row of groupFieldsForLayout(fields, payload)) {
      if (row.type === 'colors') {
        grid.appendChild(renderColorGroup(row.fields, payload, { onPickColor }));
      } else if (row.type === 'image') {
        grid.appendChild(renderImageField(row.field, payload));
      } else if (row.type === 'note') {
        grid.appendChild(renderTextField(row.field, payload, 'note'));
      } else {
        const rowEl = document.createElement('div');
        rowEl.className = 'fields-row';
        for (const item of row.items) {
          if (isCamelotField(item.field)) {
            rowEl.appendChild(renderCamelotField(item.field, payload));
          } else {
            rowEl.appendChild(renderTextField(item.field, payload, item.display));
          }
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

function renderColorGroup(fields, payload, { onPickColor } = {}) {
  const row = document.createElement('div');
  row.className = 'colors-row';

  for (const field of fields) {
    row.appendChild(renderColorField(field, payload, { onPickColor }));
  }
  const cards = [...row.querySelectorAll(':scope > .field-color')];
  row.hidden = cards.length > 0 && cards.every((card) => card.hidden);

  return row;
}

function makeColorPickButton(label, color, onPick) {
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'color-swatch-open';
  openBtn.setAttribute('aria-label', `Pick ${label} color`);
  openBtn.title = `Pick ${label} color`;

  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  applyColorSwatchStyle(swatch, color);
  swatch.setAttribute('aria-hidden', 'true');
  openBtn.appendChild(swatch);

  const badge = document.createElement('span');
  badge.className = 'color-swatch-edit-badge';
  badge.textContent = 'Pick';
  badge.setAttribute('aria-hidden', 'true');
  openBtn.appendChild(badge);

  openBtn.addEventListener('click', onPick);
  return openBtn;
}

function renderImageField(field, payload) {
  const label = fieldLabel(field);
  const raw = payload?.row?.[field.column];
  const parsed = parseImageCell(raw);

  const card = document.createElement('div');
  card.className = 'field field--image';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  if (!parsed) {
    const empty = document.createElement('p');
    empty.className = 'field-value empty';
    empty.textContent = '—';
    card.appendChild(empty);
    return card;
  }

  const body = document.createElement('div');
  body.className = 'field-image-body';

  const img = document.createElement('img');
  img.className = 'field-image';
  img.src = parsed.url;
  img.alt = label;
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => {
    img.replaceWith(Object.assign(document.createElement('p'), {
      className: 'field-value empty',
      textContent: 'Image failed to load',
    }));
  });
  body.appendChild(img);
  card.appendChild(body);
  return card;
}

function renderColorField(field, payload, { onPickColor } = {}) {
  const column = field.column;
  const label = fieldLabel(field);
  const raw = payload.row?.[column];
  const color = parseRgbCell(raw);

  const card = document.createElement('div');
  card.className = 'field field-color field--color';
  if (column) card.dataset.liveColumn = column;

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  if (!color) card.classList.add('field-color--empty');

  if (!color && !onPickColor) {
    card.hidden = true;
    const empty = document.createElement('p');
    empty.className = 'field-value empty';
    empty.textContent = '—';
    card.appendChild(empty);
    if (column) card.appendChild(renderLiveColorHost(column));
    return card;
  }

  const body = document.createElement('div');
  body.className = 'color-body';

  if (onPickColor) {
    body.appendChild(makeColorPickButton(label, color, () => onPickColor(column)));
  } else if (color) {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    applyColorSwatchStyle(swatch, color);
    swatch.setAttribute('aria-label', `${label}: ${color.rgbText}`);
    body.appendChild(swatch);
  }

  if (color) {
    const values = document.createElement('div');
    values.className = 'color-values';
    values.appendChild(makeCopyButton('RGB', color.rgbText));
    if (color.kind !== 'rainbow' && color.hex) {
      values.appendChild(makeCopyButton('Hex', color.hex));
    }
    body.appendChild(values);
  }

  card.appendChild(body);
  if (column) card.appendChild(renderLiveColorHost(column));
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

function updateStatusBar({ connected, lastUpdate, payload, simulated = null, sessionLog = null }) {
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

  const transport = bar.querySelector('[data-role="transport"]');
  if (transport) {
    const playing = payload?.isPlaying;
    if (playing === true) {
      transport.hidden = false;
      transport.classList.toggle('transport-indicator--playing', true);
      transport.classList.toggle('transport-indicator--stopped', false);
      transport.title = 'Ableton playing';
      transport.setAttribute('aria-label', 'Ableton playing');
      if (transport.dataset.state !== 'playing') {
        transport.dataset.state = 'playing';
        transport.innerHTML = TRANSPORT_PLAY_ICON;
      }
    } else if (playing === false) {
      transport.hidden = false;
      transport.classList.toggle('transport-indicator--playing', false);
      transport.classList.toggle('transport-indicator--stopped', true);
      transport.title = 'Ableton stopped';
      transport.setAttribute('aria-label', 'Ableton stopped');
      if (transport.dataset.state !== 'stopped') {
        transport.dataset.state = 'stopped';
        transport.innerHTML = TRANSPORT_PAUSE_ICON;
      }
    } else {
      transport.hidden = true;
      transport.removeAttribute('aria-label');
      transport.removeAttribute('title');
      transport.dataset.state = '';
      transport.innerHTML = '';
      transport.classList.remove('transport-indicator--playing', 'transport-indicator--stopped');
    }
  }

  const tempoEl = bar.querySelector('[data-role="tempo"]');
  if (tempoEl) {
    const tempoText = formatStatusTempo(payload?.tempo);
    if (tempoText) {
      tempoEl.hidden = false;
      tempoEl.textContent = tempoText;
      tempoEl.title = `Ableton tempo: ${formatTempo(payload.tempo)}`;
      tempoEl.setAttribute('aria-label', `Ableton tempo ${formatTempo(payload.tempo)}`);
    } else {
      tempoEl.hidden = true;
      tempoEl.textContent = '';
      tempoEl.removeAttribute('title');
      tempoEl.removeAttribute('aria-label');
    }
  }

  const simPill = document.getElementById('sim-pill');
  const stalePill = document.getElementById('stale-pill');
  const arrPill = document.getElementById('arr-pill');
  const staleOn = Boolean(payload?.stale);
  const arrOn = hasArrangementPlayback(payload);
  if (simPill) simPill.hidden = !simOn;
  if (stalePill) stalePill.hidden = !staleOn;
  if (arrPill) arrPill.hidden = !arrOn;
  bar.classList.toggle('status-bar--alert', simOn || staleOn || mode === 'ingest-stale');

  const sessionLogEl = bar.querySelector('[data-role="session-log"]');
  if (sessionLogEl) {
    const logging = sessionLog?.enabled === true && sessionLog?.sessionName;
    if (logging) {
      sessionLogEl.hidden = false;
      sessionLogEl.textContent = `Log: ${sessionLog.sessionName}`;
      sessionLogEl.title = `Session log: ${sessionLog.sessionName}.jsonl`;
      sessionLogEl.setAttribute('aria-label', `Session log ${sessionLog.sessionName}`);
    } else {
      sessionLogEl.hidden = true;
      sessionLogEl.textContent = '';
      sessionLogEl.removeAttribute('title');
      sessionLogEl.removeAttribute('aria-label');
    }
  }
}

export function setConnectionState(connected, lastUpdate, payload, simulated = null, sessionLog = null) {
  updateStatusBar({ connected, lastUpdate, payload, simulated, sessionLog });
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

/** Compact header tempo, e.g. "128" or "90.5". */
function formatStatusTempo(tempo) {
  if (tempo == null || Number.isNaN(Number(tempo))) return null;
  const n = Number(tempo);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
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

function formatRgbTriplet(c) {
  if (!c || !Number.isInteger(c.r)) return '—';
  return `${c.r},${c.g},${c.b}`;
}

function formatSacnStat(liveColors) {
  if (!liveColors?.enabled) {
    return { value: 'Disabled', warn: false };
  }
  const uni = liveColors.universe != null ? `U${liveColors.universe}` : 'sACN';
  const colors = liveColors.colors;
  const rgb = colors
    ? `${formatRgbTriplet(colors.main)} · ${formatRgbTriplet(colors.secondary)} · ${formatRgbTriplet(colors.accent)}`
    : 'no data';
  if (liveColors.live) {
    return { value: `Live ${uni} · ${rgb}`, warn: false };
  }
  return { value: `No signal ${uni}`, warn: true };
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

function renderBoardModeToggle(boardMode, onBoardModeChange) {
  if (typeof onBoardModeChange !== 'function') return null;

  const group = document.createElement('div');
  group.className = 'cue-pane-toggle admin-board-toggle';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Admin layout');

  for (const id of ['dashboard', 'detail']) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `cue-pane-btn cue-pane-btn--${id}`;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', boardMode === id ? 'true' : 'false');
    btn.textContent = id === 'dashboard' ? 'Dashboard' : 'Detail';
    btn.addEventListener('click', () => {
      if (boardMode !== id) onBoardModeChange(id);
    });
    group.appendChild(btn);
  }

  return group;
}

function appendAdminActionButtons(actions, {
  busy,
  matched,
  pinned,
  onStartPin,
  onClearPin,
  onStartEdit,
  onStartFlashLook,
  flashLookReady = false,
  flashLookTitle = '',
  showEdit = false,
  showFlash = false,
  setDrawerOpen = false,
  onSetDrawerChange,
}) {
  if (showFlash) {
    appendLookWriteButton(actions, { onStartFlashLook, flashLookReady, flashLookTitle });
  }
  if (!busy && matched && onStartPin) {
    const changeBtn = document.createElement('button');
    changeBtn.type = 'button';
    changeBtn.className = 'view-edit-btn';
    changeBtn.textContent = 'Change cue';
    changeBtn.addEventListener('click', onStartPin);
    actions.appendChild(changeBtn);
  }
  if (!busy && pinned && onClearPin) {
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'view-edit-btn view-edit-btn--unpin';
    clearBtn.textContent = 'Clear pin';
    clearBtn.addEventListener('click', onClearPin);
    actions.appendChild(clearBtn);
  }
  if (showEdit && !busy && matched && onStartEdit) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'view-edit-btn view-edit-btn--edit';
    editBtn.innerHTML = `${EDIT_ICON}<span>Edit</span>`;
    editBtn.addEventListener('click', onStartEdit);
    actions.appendChild(editBtn);
  }
  if (typeof onSetDrawerChange === 'function') {
    const setBtn = document.createElement('button');
    setBtn.type = 'button';
    setBtn.className = 'view-edit-btn view-edit-btn--set';
    setBtn.setAttribute('aria-expanded', setDrawerOpen ? 'true' : 'false');
    setBtn.setAttribute('aria-controls', 'admin-set-drawer');
    setBtn.title = setDrawerOpen ? 'Hide set drawer' : 'Show set drawer';
    setBtn.innerHTML = `${SET_ICON}<span>Set</span>`;
    setBtn.addEventListener('click', () => onSetDrawerChange(!setDrawerOpen));
    actions.appendChild(setBtn);
  }
}

function renderAdminClipRow(root, {
  payload,
  matchColumn,
  busy,
  pinned,
  matched,
  getMomentWho,
  boardMode,
  onBoardModeChange,
  onStartPin,
  onClearPin,
  onStartEdit,
  onStartFlashLook,
  flashLookReady,
  flashLookTitle,
  showEdit = false,
  showFlash = false,
  noMatchHero = false,
  setDrawerOpen = false,
  onSetDrawerChange,
  cuePane = 'current',
  onCuePaneChange,
}) {
  const clipRow = document.createElement('div');
  clipRow.className = 'clip-head-row';

  const clipHead = document.createElement('div');
  clipHead.id = 'admin-clip-head';
  clipRow.appendChild(clipHead);
  const pane = resolveCuePane(payload, cuePane, { busy });
  renderAdminClipHead(clipHead, payload, matchColumn, {
    busy,
    noMatchHero,
    cuePane: pane ?? cuePane,
  });

  const actions = document.createElement('div');
  actions.className = 'view-edit-actions';
  if (getMomentWho != null) prependDopeButton(actions, getMomentWho);
  const toggle = renderBoardModeToggle(boardMode, onBoardModeChange);
  if (toggle) actions.appendChild(toggle);
  if (pane && typeof onCuePaneChange === 'function') {
    actions.appendChild(renderCuePaneToggle(pane, onCuePaneChange));
  }
  appendAdminActionButtons(actions, {
    busy,
    matched,
    pinned,
    onStartPin,
    onClearPin,
    onStartEdit,
    onStartFlashLook,
    flashLookReady,
    flashLookTitle,
    showEdit,
    showFlash,
    setDrawerOpen,
    onSetDrawerChange,
  });
  if (actions.childNodes.length) clipRow.appendChild(actions);
  root.appendChild(clipRow);
}

function renderDashboardLook(parent, zones, payload) {
  const camelot = zones.camelot ?? [];
  if (!zones.images.length && !zones.tokens.length && !zones.colors.length && !camelot.length) return;

  const look = document.createElement('section');
  look.className = 'admin-dashboard-look';
  look.setAttribute('aria-label', 'Look');

  if (zones.images.length || zones.tokens.length || camelot.length) {
    const identity = document.createElement('div');
    identity.className = 'admin-dashboard-identity';
    if (zones.images.length) {
      const art = document.createElement('div');
      art.className = 'admin-dashboard-art';
      for (const field of zones.images) {
        art.appendChild(renderImageField(field, payload));
      }
      identity.appendChild(art);
    }
    if (zones.tokens.length || camelot.length) {
      const tokens = document.createElement('div');
      tokens.className = 'admin-dashboard-tokens';
      for (const field of zones.tokens) {
        tokens.appendChild(renderTextField(field, payload, 'token', 'hero'));
      }
      for (const field of camelot) {
        tokens.appendChild(renderCamelotField(field, payload));
      }
      identity.appendChild(tokens);
    }
    look.appendChild(identity);
  }

  if (zones.colors.length) {
    const mast = document.createElement('div');
    mast.className = 'admin-dashboard-mast';
    const colors = renderColorGroup(zones.colors, payload);
    mast.appendChild(colors);
    mast.hidden = colors.hidden;
    look.appendChild(mast);
  }

  if ([...look.children].some((el) => !el.hidden)) parent.appendChild(look);
}

function renderDashboardNotes(parent, zones, payload) {
  if (!zones.noteGroups.length) return;

  const notes = document.createElement('section');
  notes.className = 'admin-dashboard-notes';
  notes.style.setProperty('--dash-note-cols', String(zones.noteGroups.length));
  notes.setAttribute('aria-label', 'Cue notes');

  for (const group of zones.noteGroups) {
    const col = document.createElement('article');
    col.className = 'admin-dashboard-note-col';
    const heading = document.createElement('h2');
    heading.className = 'admin-dashboard-note-title';
    heading.textContent = group.title;
    col.appendChild(heading);
    if (group.id === 'visuals') {
      const breathHost = document.createElement('div');
      breathHost.id = 'admin-dash-breath';
      breathHost.className = 'admin-dashboard-breath';
      breathHost.setAttribute('aria-label', 'Breath');
      col.appendChild(breathHost);
    }
    for (const field of group.fields) {
      const display = resolveFieldDisplay(field, getFieldValue(field, payload), { layout: 'hero' });
      col.appendChild(renderTextField(field, payload, display === 'token' ? 'text' : display));
    }
    notes.appendChild(col);
  }

  parent.appendChild(notes);
}

function renderAdminDashboard(root, ctx) {
  const {
    payload,
    connected,
    lastUpdate,
    matchColumn = null,
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
    pinSession = null,
    pinPanel = null,
    onStartPin,
    onPinLast,
    onClearPin,
    getMomentWho = null,
    operatorViews = [],
    boardMode = 'dashboard',
    onBoardModeChange,
    onStartFlashLook,
    flashLookReady = false,
    flashLookTitle = '',
    setDrawerOpen = false,
    onSetDrawerChange,
    cuePane = 'current',
    onCuePaneChange,
  } = ctx;

  closeColorPicker();
  root.innerHTML = '';

  const busy = Boolean(editSession || aliasSession || pinSession);
  const pinned = payload?.match?.viaOverride === true;
  const matched = payload?.match?.matched === true;
  const pane = resolveCuePane(payload, cuePane, { busy });
  const zones = buildDashboardZones(operatorViews);
  const showFlash = !busy && matched && typeof onStartFlashLook === 'function';

  renderAdminClipRow(root, {
    payload,
    matchColumn,
    busy,
    pinned,
    matched,
    getMomentWho,
    boardMode,
    onBoardModeChange,
    onStartPin,
    onClearPin,
    onStartEdit,
    onStartFlashLook,
    flashLookReady,
    flashLookTitle,
    showEdit: true,
    showFlash,
    noMatchHero: true,
    setDrawerOpen,
    onSetDrawerChange,
    cuePane,
    onCuePaneChange,
  });

  const board = document.createElement('div');
  board.className = 'admin-dashboard-board';

  const showNoMatch = payload && !matched && !busy
    && (hasPlayingClips(payload) || payload.clipName?.trim());

  if (pinSession && pinPanel) {
    renderPinPanel(board, pinPanel);
  } else if (aliasSession && aliasPanel) {
    renderAliasPanel(board, aliasPanel);
  } else if (editSession) {
    renderRowEditorPanel(board, {
      session: editSession,
      editorColumns,
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
    });
  } else {
    const showZones = matched || pane === 'last';
    const zonePayload = matched ? payload : lastPanePayload(payload);
    if (showNoMatch && !showZones) {
      renderNoMatchPanel(board, {
        payload,
        editable: true,
        aliasSession,
        createSession: null,
        onStartCreate,
        onStartAlias,
        onStartPin,
        onPinLast,
      });
    }
    if (showZones && zonePayload) {
      renderDashboardLook(board, zones, zonePayload);
      renderDashboardNotes(board, zones, zonePayload);
    }
  }

  const sessionPane = document.createElement('section');
  sessionPane.className = 'admin-dashboard-session';
  sessionPane.setAttribute('aria-label', 'Session');
  renderSceneBanner(sessionPane, payload);
  renderSessionTracks(sessionPane, {
    payload,
    aliasSession,
    editSession,
    onStartAlias,
    onStartCreate,
    compact: true,
  });

  const showSetDrawer = setDrawerOpen === true && !busy;
  if (showSetDrawer) {
    board.classList.add('admin-dashboard-board--set-open');
    const main = document.createElement('div');
    main.className = 'admin-dashboard-main';
    while (board.firstChild) main.appendChild(board.firstChild);
    board.appendChild(main);

    const drawer = document.createElement('aside');
    drawer.id = 'admin-set-drawer';
    drawer.className = 'admin-set-drawer';
    drawer.setAttribute('aria-label', 'Set');

    const log = document.createElement('div');
    log.id = 'admin-set-log';
    log.className = 'admin-set-log';
    drawer.appendChild(log);

    const nav = document.createElement('div');
    nav.id = 'admin-set-nav';
    nav.className = 'admin-set-nav';
    drawer.appendChild(nav);

    board.appendChild(drawer);
  }

  board.appendChild(sessionPane);

  root.appendChild(board);
  updateStatusBar({ connected, lastUpdate, payload });
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
  pinSession = null,
  pinPanel = null,
  onStartPin,
  onPinLast,
  onClearPin,
  getMomentWho = null,
  boardMode = 'detail',
  onBoardModeChange,
  operatorViews = [],
  onStartFlashLook,
  flashLookReady = false,
  flashLookTitle = '',
  setDrawerOpen = false,
  onSetDrawerChange,
  cuePane = 'current',
  onCuePaneChange,
}) {
  if (boardMode === 'dashboard') {
    renderAdminDashboard(root, {
      title,
      payload,
      status,
      connected,
      lastUpdate,
      matchColumn,
      aliasColumn,
      editSession,
      aliasSession,
      aliasPanel,
      editorColumns,
      saveState,
      saveError,
      onStartEdit,
      onStartCreate,
      onStartAlias,
      onCancelEdit,
      onSaveEdit,
      pinSession,
      pinPanel,
      onStartPin,
      onPinLast,
      onClearPin,
      getMomentWho,
      operatorViews,
      boardMode,
      onBoardModeChange,
      onStartFlashLook,
      flashLookReady,
      flashLookTitle,
      setDrawerOpen,
      onSetDrawerChange,
      cuePane,
      onCuePaneChange,
    });
    return;
  }

  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'Admin';
  root.appendChild(titleEl);

  const busy = Boolean(editSession || aliasSession || pinSession);
  const pinned = payload?.match?.viaOverride === true;
  const matched = payload?.match?.matched === true;

  renderAdminClipRow(root, {
    payload,
    matchColumn,
    busy,
    pinned,
    matched,
    getMomentWho,
    boardMode,
    onBoardModeChange,
    onStartPin,
    onClearPin,
    cuePane,
    onCuePaneChange,
  });

  const stats = document.createElement('div');
  stats.id = 'admin-stats';
  stats.className = 'admin-stats';
  root.appendChild(stats);
  renderAdminStats(stats, payload, status);
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
      onStartPin,
      onPinLast,
    });
  }

  if (pinSession && pinPanel) {
    renderPinPanel(root, pinPanel);
  } else if (aliasSession && aliasPanel) {
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
    renderReadOnlyRowPanel(root, {
      payload,
      onStartEdit,
      editorColumns,
    });
  } else if (payload?.match?.matched === true && payload.row) {
    renderReadOnlyRowPanel(root, {
      payload,
      onStartEdit: () => {},
      editorColumns,
    });
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

export function updateAdminLiveChrome(root, {
  payload,
  status,
  connected,
  lastUpdate,
  editSession,
  matchColumn = null,
  noMatchHero = false,
  refreshClipHead = true,
  cuePane = 'current',
} = {}) {
  const clipHead = root.querySelector('#admin-clip-head');
  const busy = Boolean(editSession);
  // Dashboard paints No Match / Last matched in the hero. Chrome ticks (sACN,
  // timecode status) must use the same noMatchHero flag or the title vanishes.
  if (refreshClipHead && clipHead) {
    renderAdminClipHead(clipHead, payload, matchColumn, { busy, noMatchHero, cuePane });
  }

  const stats = root.querySelector('#admin-stats');
  if (stats) renderAdminStats(stats, payload, status);

  if (editSession) updateEditContextBanner(root, editSession, payload);

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderAdminClipHead(parent, payload, matchColumn = null, {
  busy = false,
  noMatchHero = false,
  cuePane = 'current',
} = {}) {
  parent.innerHTML = '';
  const hero = resolveHeroDisplay(payload, matchColumn, { busy, noMatchHero, cuePane });
  if (!hero.showHero) {
    return;
  }
  renderHeroRow(parent, hero.text, payload, {
    empty: hero.empty,
    noMatch: hero.noMatch,
    lastMatched: hero.lastMatched,
    pinned: hero.pinned,
  });

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
  const pinned = payload?.match?.viaOverride === true;
  const clipName = payload?.clipName?.trim() || null;
  const playing = hasPlayingClips(payload);
  addStat(
    parent,
    'Match',
    pinned ? 'Manual' : matched ? 'Yes' : 'No',
    { warn: Boolean(pinned || (payload && !matched && (playing || clipName))) },
  );
  addStat(parent, 'Confidence', formatConfidence(payload?.match?.confidence));
  addStat(parent, 'Row ID', payload?.match?.rowId ?? '—');
  addStat(parent, 'Matched value', payload?.match?.matchedValue ?? '—');
  addStat(parent, 'Via alias', payload?.match?.viaAlias ? 'Yes' : 'No');
  addStat(parent, 'Via override', pinned ? 'Yes' : 'No', { warn: pinned });
  addStat(parent, 'Tempo', formatTempo(payload?.tempo));
  addStat(parent, 'Beat', formatBeat(payload?.beat));
  if (Array.isArray(payload?.tracks) && payload.tracks.length) {
    addStat(parent, 'Playback', hasArrangementPlayback(payload) ? 'Arrangement' : 'Session');
  }
  addStat(parent, 'Last sync', formatTimestamp(payload?.syncedAt));
  addStat(parent, 'Cache', payload?.stale ? 'Stale (offline)' : 'Fresh', { warn: payload?.stale });
  {
    const tc = formatTimecodeStat(status?.timecode);
    addStat(parent, 'Timecode', tc.value, { warn: tc.warn });
  }
  {
    const sacn = formatSacnStat(status?.liveColors);
    addStat(parent, 'GrandMA sACN', sacn.value, { warn: sacn.warn });
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
