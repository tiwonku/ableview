// Setlist view: night-specific ordered sheet rows. Glance + pin override; not a match source.

import { setConnectionState } from './view-render.js';
import { hasPlayingClips, resolveMatchedTitle } from './playing-clips-strip.js';
import { prependDopeButton } from './moment-controls.js';
import { renderRowEditorPanel, updateEditContextBanner } from './admin-row-editor.js';
import { renderAliasPanel } from './alias-panel.js';
import { renderPinPanel } from './pin-panel.js';
import { withKioskQuery } from './kiosk-controls.js';

export const SETLIST_STATUSES = Object.freeze(['confirmed', 'likely', 'maybe']);
export const SETLIST_KEY_COLUMN = 'Key';

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  maybe: 'Maybe',
};

let lastScrolledRowId = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Live-board rowId when a cue is showing. Null when unmatched (NFR-7). */
export function currentSetlistRowId(payload) {
  if (payload?.match?.matched !== true) return null;
  const id = payload.match.rowId;
  return id != null && String(id).trim() !== '' ? String(id) : null;
}

export function itemDisplayTitle(item) {
  return String(item?.liveTitle || item?.title || '').trim() || `Row ${item?.rowId ?? '?'}`;
}

export function itemDisplayKey(item) {
  return String(item?.key ?? '').trim();
}

/** Sheet columns for the empty-search shortcut (title + key only). */
export function buildQuickCueChanges({
  title,
  key,
  matchColumn,
  keyColumn = SETLIST_KEY_COLUMN,
} = {}) {
  const song = String(title ?? '').trim();
  const changes = {};
  if (matchColumn && song) changes[matchColumn] = song;
  const trimmedKey = String(key ?? '').trim();
  if (keyColumn && trimmedKey) changes[keyColumn] = trimmedKey;
  return changes;
}

function renderKeyBadge(key, className = 'setlist-item-key') {
  const value = String(key ?? '').trim();
  const badge = el('div', value ? className : `${className} setlist-item-key--empty`);
  badge.textContent = value || '—';
  badge.title = value ? `Key ${value}` : 'No key on cue sheet';
  return badge;
}

export function formatSetConfidence(confidence) {
  if (confidence == null || Number.isNaN(Number(confidence))) return null;
  return `${Math.round(Number(confidence) * 100)}%`;
}

export function formatSyncedAge(iso, now = Date.now()) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

/**
 * Glance model for the Set live card. Not a match source.
 * @returns {{
 *   tone: 'idle'|'live'|'pinned'|'nomatch',
 *   eyebrow: string,
 *   title: string,
 *   meta: string,
 *   next: string,
 *   last: string,
 *   onSet: boolean|null,
 *   currentIndex: number,
 * }}
 */
export function liveBoardModel(payload, { matchColumn = null, setlist = null } = {}) {
  const items = Array.isArray(setlist?.items) ? setlist.items : [];
  const liveRowId = currentSetlistRowId(payload);
  const currentIndex = liveRowId
    ? items.findIndex((item) => String(item.rowId) === liveRowId)
    : -1;
  const nextItem = currentIndex >= 0 ? items[currentIndex + 1] ?? null : null;

  if (!payload) {
    return {
      tone: 'idle',
      eyebrow: 'WAITING',
      title: 'Waiting for Ableton…',
      meta: '',
      next: '',
      last: '',
      onSet: null,
      currentIndex: -1,
    };
  }

  if (payload.match?.matched !== true) {
    const clip = payload.clipName?.trim();
    const lastTitle = payload.lastMatched?.title?.trim();
    return {
      tone: 'nomatch',
      eyebrow: 'NO MATCH',
      title: clip || 'No confident match',
      meta: clip ? `Playing “${clip}”` : 'No confident match',
      next: '',
      last: lastTitle ? `Last: ${lastTitle}` : '',
      onSet: false,
      currentIndex: -1,
    };
  }

  const title = resolveMatchedTitle(payload, matchColumn) || payload.match?.matchedValue || 'Matched';
  const clip = payload.clipName?.trim();
  const pinned = payload.match?.viaOverride === true;
  const parts = [];
  if (clip && clip !== title) parts.push(`Clip “${clip}”`);
  if (!pinned) {
    const conf = formatSetConfidence(payload.match?.confidence);
    if (conf) parts.push(conf);
  }
  if (payload.match?.viaAlias) parts.push('via alias');
  if (pinned) parts.push('Pinned · clears on next auto match');
  if (currentIndex >= 0) parts.push(`on set · #${currentIndex + 1}`);
  else parts.push('Not on tonight’s set');

  return {
    tone: pinned ? 'pinned' : 'live',
    eyebrow: pinned ? 'PINNED' : 'LIVE',
    title,
    meta: parts.join(' · '),
    next: nextItem
      ? `Next · ${itemDisplayTitle(nextItem)}${itemDisplayKey(nextItem) ? ` · ${itemDisplayKey(nextItem)}` : ''}`
      : '',
    last: '',
    onSet: currentIndex >= 0,
    currentIndex,
  };
}

/**
 * Compact health chips for show-night glance. `connectedViews` includes this Set tab.
 */
export function setHealthChips(payload, status, { simulated = null } = {}) {
  const simOn = simulated != null ? Boolean(simulated) : Boolean(payload?.simulated);
  const chips = [];

  if (!simOn) {
    const ingest = payload?.ableton ?? status?.ingest ?? null;
    const live = ingest?.live ?? payload?.ingestLive !== false;
    chips.push({
      id: 'ableton',
      label: live ? 'Ableton' : 'Ableton off',
      warn: !live,
    });
  }

  const stale = Boolean(payload?.stale);
  const age = formatSyncedAge(payload?.syncedAt);
  chips.push({
    id: 'sheet',
    label: stale ? 'Sheet stale' : (age ? `Sheet ${age}` : 'Sheet'),
    warn: stale,
    action: 'sync',
  });

  const matched = payload?.match?.matched === true;
  const playing = hasPlayingClips(payload) || Boolean(payload?.clipName?.trim());
  if (payload && !matched && playing) {
    chips.push({ id: 'match', label: 'No match', warn: true });
  }

  if (status?.connectedViews != null) {
    const others = Math.max(0, Number(status.connectedViews) - 1);
    chips.push({
      id: 'views',
      label: others === 0 ? 'No other views' : (others === 1 ? '1 other view' : `${others} other views`),
      warn: others === 0,
    });
  }

  if (!simOn) {
    const ingest = status?.ingest ?? payload?.ableton ?? null;
    if (ingest?.cueTrackConfigured && ingest.cueTrackFound === false) {
      chips.push({ id: 'cue-track', label: 'Cue track missing', warn: true });
    }
  }

  return chips;
}

/** Remember setlist search / name inputs across full re-renders. */
export function captureSetlistFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLSelectElement)
    && !(active instanceof HTMLTextAreaElement)) {
    return null;
  }
  const field = active.dataset.setlistField;
  if (!field) return null;
  const restore = { field };
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    restore.start = active.selectionStart ?? 0;
    restore.end = active.selectionEnd ?? 0;
  }
  return restore;
}

function restoreSetlistFocus(root, focus, { autoFocusSearch = false } = {}) {
  if (focus?.field) {
    const target = root.querySelector(`[data-setlist-field="${focus.field}"]`);
    if (target) {
      target.focus();
      if (typeof focus.start === 'number' && target.setSelectionRange) {
        try {
          target.setSelectionRange(focus.start, focus.end);
        } catch {
          // some input types reject setSelectionRange
        }
      }
      return;
    }
  }
  if (autoFocusSearch) {
    const search = root.querySelector('[data-setlist-field="search"]');
    search?.focus();
    search?.select?.();
  }
}

function secondaryLabel(result) {
  const als = result.secondary?.find((s) => s.column === 'ALS Folder');
  if (als?.value) return als.value;
  if (result.aliases) return `Aliases: ${result.aliases}`;
  return '';
}

function renderQuickCreate({ title, key, busy, onCreateKeyChange, onCreateCue }) {
  const form = el('form', 'setlist-create');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    onCreateCue?.({ title, key });
  });

  form.appendChild(el(
    'p',
    'setlist-create-copy',
    `No cue row for “${title}”. Add it with a key:`,
  ));

  const field = el('label', 'setlist-create-field');
  field.appendChild(el('span', 'setlist-create-label', 'Key'));
  const keyInput = el('input', 'alias-search-input setlist-create-key');
  keyInput.type = 'text';
  keyInput.name = 'key';
  keyInput.placeholder = 'Am, F#, Bb…';
  keyInput.value = key ?? '';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.dataset.setlistField = 'create-key';
  keyInput.disabled = busy;
  keyInput.setAttribute('aria-label', `Key for ${title}`);
  keyInput.addEventListener('input', () => onCreateKeyChange?.(keyInput.value));
  field.appendChild(keyInput);
  form.appendChild(field);

  const submit = el('button', 'admin-editor-btn admin-editor-btn--primary', 'Add to set');
  submit.type = 'submit';
  submit.disabled = busy || !String(title ?? '').trim() || !String(key ?? '').trim();
  submit.title = 'Create a cue sheet row with this title and key, then add it to tonight’s set';
  form.appendChild(submit);
  return form;
}

function fillLiveCopy(copy, model) {
  copy.replaceChildren();
  copy.appendChild(el('p', 'setlist-live-eyebrow', model.eyebrow));
  copy.appendChild(el('h2', 'setlist-live-title', model.title));
  if (model.meta) copy.appendChild(el('p', 'setlist-live-meta', model.meta));
  if (model.last) copy.appendChild(el('p', 'setlist-live-last', model.last));
  if (model.next) copy.appendChild(el('p', 'setlist-live-next', model.next));
}

function fillHealthChips(host, chips, { onSyncSheet, syncing = false } = {}) {
  host.replaceChildren();
  for (const chip of chips) {
    const isSync = chip.action === 'sync' && typeof onSyncSheet === 'function';
    const node = el(
      isSync ? 'button' : 'span',
      `setlist-chip${chip.warn ? ' setlist-chip--warn' : ''}${isSync ? ' setlist-chip--action' : ''}`,
      syncing && isSync ? 'Syncing…' : chip.label,
    );
    if (isSync) {
      node.type = 'button';
      node.title = 'Sync Google Sheet now';
      node.disabled = syncing;
      node.addEventListener('click', () => onSyncSheet());
    }
    host.appendChild(node);
  }
}

function renderNoMatchActions(parent, { onStartCreate, onStartAlias, onStartPin, onPinLast }) {
  if (!onStartCreate && !onStartAlias && !onStartPin && !onPinLast) return;
  const actions = el('div', 'setlist-live-recover');
  if (onPinLast) {
    const btn = el('button', 'admin-editor-btn admin-editor-btn--primary', 'Pin last cue');
    btn.type = 'button';
    btn.addEventListener('click', () => onPinLast());
    actions.appendChild(btn);
  }
  if (onStartPin) {
    const btn = el('button', 'admin-editor-btn', 'Pin from set');
    btn.type = 'button';
    btn.addEventListener('click', () => onStartPin());
    actions.appendChild(btn);
  }
  if (onStartCreate) {
    const btn = el('button', 'admin-editor-btn admin-editor-btn--primary', 'Add cue row');
    btn.type = 'button';
    btn.addEventListener('click', () => onStartCreate());
    actions.appendChild(btn);
  }
  if (onStartAlias) {
    const btn = el('button', 'admin-editor-btn', 'Add as alias');
    btn.type = 'button';
    btn.addEventListener('click', () => onStartAlias());
    actions.appendChild(btn);
  }
  parent.appendChild(actions);
}

function renderLiveActions(parent, {
  matched,
  pinned,
  busy,
  getMomentWho,
  onStartEdit,
  onStartPin,
  onClearPin,
}) {
  const actions = el('div', 'view-edit-actions setlist-live-actions');
  if (getMomentWho != null) prependDopeButton(actions, getMomentWho);
  if (!busy && matched && onStartPin) {
    const changeBtn = el('button', 'view-edit-btn', 'Change cue');
    changeBtn.type = 'button';
    changeBtn.title = 'Pin a different cue onto the live board';
    changeBtn.addEventListener('click', onStartPin);
    actions.appendChild(changeBtn);
  }
  if (!busy && pinned && onClearPin) {
    const clearBtn = el('button', 'view-edit-btn view-edit-btn--unpin', 'Clear pin');
    clearBtn.type = 'button';
    clearBtn.title = 'Return the live board to automatic matching';
    clearBtn.addEventListener('click', onClearPin);
    actions.appendChild(clearBtn);
  }
  if (!busy && matched && onStartEdit) {
    const editBtn = el('button', 'view-edit-btn view-edit-btn--edit', 'Edit');
    editBtn.type = 'button';
    editBtn.title = 'Edit this cue-sheet row';
    editBtn.addEventListener('click', onStartEdit);
    actions.appendChild(editBtn);
  }
  if (actions.childNodes.length) parent.appendChild(actions);
}

function renderLiveCard(root, ctx, model) {
  const {
    payload,
    status,
    simulated = null,
    syncing = false,
    editSession = null,
    aliasSession = null,
    pinSession = null,
    getMomentWho = null,
    onStartEdit,
    onStartCreate,
    onStartAlias,
    onStartPin,
    onPinLast,
    onClearPin,
    onSyncSheet,
  } = ctx;

  const matched = payload?.match?.matched === true;
  const pinned = payload?.match?.viaOverride === true;
  const busy = Boolean(editSession || aliasSession || pinSession);
  const showNoMatch = Boolean(payload) && !matched && !busy
    && (hasPlayingClips(payload) || payload.clipName?.trim());

  const card = el('section', `setlist-live setlist-live--${model.tone}`);
  card.id = 'setlist-live';
  card.setAttribute('aria-label', 'Live board');

  const top = el('div', 'setlist-live-top');
  const copy = el('div', 'setlist-live-copy');
  copy.dataset.role = 'setlist-live-copy';
  fillLiveCopy(copy, model);
  top.appendChild(copy);
  renderLiveActions(top, {
    matched,
    pinned,
    busy,
    getMomentWho,
    onStartEdit,
    onStartPin,
    onClearPin,
  });
  card.appendChild(top);

  const health = el('div', 'setlist-health');
  health.dataset.role = 'setlist-health';
  fillHealthChips(health, setHealthChips(payload, status, { simulated }), { onSyncSheet, syncing });
  card.appendChild(health);

  if (showNoMatch) {
    renderNoMatchActions(card, {
      onStartCreate,
      onStartAlias,
      onStartPin,
      onPinLast: payload?.lastMatched?.rowId ? onPinLast : undefined,
    });
  }

  root.appendChild(card);
  return card;
}

export function updateSetlistLiveChrome(root, ctx) {
  const {
    payload,
    setlist,
    matchColumn = null,
    connected,
    lastUpdate,
    simulated = null,
    sessionLog = null,
    status = null,
    syncing = false,
    editSession = null,
    onSyncSheet,
  } = ctx;

  setConnectionState(connected, lastUpdate, payload, simulated, sessionLog);

  const card = root?.querySelector?.('#setlist-live');
  if (card) {
    const model = liveBoardModel(payload, { matchColumn, setlist });
    card.className = `setlist-live setlist-live--${model.tone}`;
    const copy = card.querySelector('[data-role="setlist-live-copy"]');
    if (copy) fillLiveCopy(copy, model);
    const health = card.querySelector('[data-role="setlist-health"]');
    if (health) {
      fillHealthChips(health, setHealthChips(payload, status, { simulated }), { onSyncSheet, syncing });
    }
  }

  if (editSession) updateEditContextBanner(root, editSession, payload);
}

function scrollCurrentIntoView(root, liveRowId) {
  if (!liveRowId) {
    lastScrolledRowId = null;
    return;
  }
  if (liveRowId === lastScrolledRowId) return;
  lastScrolledRowId = liveRowId;
  root.querySelector('.setlist-item--current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * @param {HTMLElement} root
 * @param {object} ctx
 */
export function renderSetlist(root, ctx) {
  const {
    title,
    payload,
    setlist,
    matchColumn = null,
    connected,
    lastUpdate,
    simulated = null,
    sessionLog = null,
    addQuery = '',
    addResults = [],
    addSearching = false,
    addOpen = false,
    createKey = '',
    nameDraft = '',
    saveState = 'idle',
    saveError = null,
    syncing = false,
    focusRestore = null,
    autoFocusSearch = false,
    editSession = null,
    aliasSession = null,
    aliasPanel = null,
    pinSession = null,
    pinPanel = null,
    editorColumns = {},
    onAddQueryChange,
    onAddOpenChange,
    onAddRow,
    onCreateKeyChange,
    onCreateCue,
    onRemove,
    onStatus,
    onMove,
    onReorder,
    onSwitch,
    onCreate,
    onDuplicate,
    onDelete,
    onNameDraftChange,
    onPin,
    onClearPin,
    getMomentWho = null,
    onStartEdit,
    onStartCreate,
    onStartAlias,
    onStartPin,
    onPinLast,
    onCancelEdit,
    onSaveEdit,
    onSyncSheet,
  } = ctx;

  setConnectionState(connected, lastUpdate, payload, simulated, sessionLog);

  root.replaceChildren();
  root.className = 'setlist-main';

  const heading = el('h1', 'view-title', title || 'Set');
  const titleRow = el('div', 'view-title-row');
  titleRow.appendChild(heading);
  root.appendChild(titleRow);

  const model = liveBoardModel(payload, { matchColumn, setlist });
  renderLiveCard(root, ctx, model);

  const sessionBusy = Boolean(editSession || aliasSession || pinSession);
  if (pinSession && pinPanel) {
    renderPinPanel(root, pinPanel);
    return;
  }
  if (aliasSession && aliasPanel) {
    renderAliasPanel(root, aliasPanel);
    return;
  }
  if (editSession && onCancelEdit && onSaveEdit) {
    renderRowEditorPanel(root, {
      session: editSession,
      editorColumns,
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
    });
    return;
  }

  const busy = saveState === 'saving' || sessionBusy;

  const toolbar = el('div', 'setlist-toolbar');

  const library = Array.isArray(setlist?.library) ? setlist.library : [];
  const currentName = setlist?.name ?? '';

  const select = el('select', 'setlist-select');
  select.dataset.setlistField = 'library';
  select.setAttribute('aria-label', 'Saved sets');
  select.disabled = busy || library.length === 0;
  if (library.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = currentName || 'No sets';
    select.appendChild(opt);
  } else {
    for (const entry of library) {
      const opt = document.createElement('option');
      opt.value = entry.name;
      const count = entry.itemCount != null ? ` (${entry.itemCount})` : '';
      opt.textContent = `${entry.name}${count}`;
      if (entry.name === currentName) opt.selected = true;
      select.appendChild(opt);
    }
  }
  select.addEventListener('change', () => {
    const name = select.value;
    if (name && name !== currentName) onSwitch?.(name);
  });
  toolbar.appendChild(select);

  const nameInput = el('input', 'setlist-name-input');
  nameInput.type = 'text';
  nameInput.placeholder = 'New set name';
  nameInput.value = nameDraft;
  nameInput.autocomplete = 'off';
  nameInput.dataset.setlistField = 'name';
  nameInput.disabled = busy;
  nameInput.addEventListener('input', () => onNameDraftChange?.(nameInput.value));
  toolbar.appendChild(nameInput);

  const newBtn = el('button', 'admin-editor-btn', 'New');
  newBtn.type = 'button';
  newBtn.disabled = busy || !nameDraft.trim();
  newBtn.addEventListener('click', () => onCreate?.(nameDraft.trim()));
  toolbar.appendChild(newBtn);

  const saveAsBtn = el('button', 'admin-editor-btn', 'Save as');
  saveAsBtn.type = 'button';
  const draft = nameDraft.trim();
  saveAsBtn.disabled = busy || !draft || draft === currentName;
  saveAsBtn.addEventListener('click', () => onDuplicate?.(draft));
  toolbar.appendChild(saveAsBtn);

  const deleteBtn = el('button', 'admin-editor-btn admin-editor-btn--danger', 'Delete');
  deleteBtn.type = 'button';
  deleteBtn.title = library.length < 2
    ? 'Create another set before deleting this one'
    : `Delete “${currentName}”`;
  deleteBtn.disabled = busy || !currentName || library.length < 2;
  deleteBtn.addEventListener('click', () => {
    if (!currentName || library.length < 2) return;
    const confirmed = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`Delete set “${currentName}”? This cannot be undone.`)
      : true;
    if (confirmed) onDelete?.();
  });
  toolbar.appendChild(deleteBtn);

  root.appendChild(toolbar);

  if (saveError) {
    root.appendChild(el('p', 'admin-editor-error', saveError));
  }

  const items = Array.isArray(setlist?.items) ? setlist.items : [];
  const showAdd = addOpen === true || items.length === 0;

  const addSection = el('section', 'setlist-add');
  const addToggle = el('button', 'setlist-add-toggle', 'Add from cue sheet');
  addToggle.type = 'button';
  addToggle.setAttribute('aria-expanded', showAdd ? 'true' : 'false');
  addToggle.addEventListener('click', () => onAddOpenChange?.(!showAdd));
  addSection.appendChild(addToggle);

  if (showAdd) {
    const searchInput = el('input', 'alias-search-input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search song title, aliases, ALS folder…';
    searchInput.value = addQuery ?? '';
    searchInput.autocomplete = 'off';
    searchInput.dataset.setlistField = 'search';
    searchInput.disabled = busy;
    searchInput.addEventListener('input', () => onAddQueryChange?.(searchInput.value));
    addSection.appendChild(searchInput);

    const resultsList = el('div', 'alias-search-results setlist-add-results');
    const onList = new Set(items.map((item) => String(item.rowId)));
    if (addSearching) {
      resultsList.appendChild(el('p', 'alias-search-empty', 'Searching…'));
    } else if (!String(addQuery ?? '').trim()) {
      resultsList.appendChild(el('p', 'alias-search-empty', 'Type to search the cue sheet.'));
    } else if (!addResults.length) {
      resultsList.appendChild(el('p', 'alias-search-empty', 'No rows matched.'));
    } else {
      for (const result of addResults) {
        const already = onList.has(String(result.rowId));
        const btn = el('button', 'alias-search-result');
        btn.type = 'button';
        btn.disabled = busy || already;
        btn.addEventListener('click', () => {
          if (!already) onAddRow?.(result);
        });
        const titleRow = el('span', 'alias-search-result-title-row');
        titleRow.appendChild(el('span', 'alias-search-result-title', result.title));
        if (result.key) {
          titleRow.appendChild(renderKeyBadge(result.key, 'setlist-item-key setlist-search-key'));
        }
        btn.appendChild(titleRow);
        const meta = el(
          'span',
          'alias-search-result-meta',
          already ? `Already on set · Row ${result.rowId}` : `Row ${result.rowId}`,
        );
        const sub = secondaryLabel(result);
        if (sub && !already) meta.textContent += ` · ${sub}`;
        btn.appendChild(meta);
        resultsList.appendChild(btn);
      }
    }
    addSection.appendChild(resultsList);

    if (
      !addSearching
      && String(addQuery ?? '').trim()
      && !addResults.length
      && typeof onCreateCue === 'function'
      && matchColumn
    ) {
      addSection.appendChild(renderQuickCreate({
        title: String(addQuery ?? '').trim(),
        key: createKey,
        busy,
        onCreateKeyChange,
        onCreateCue,
      }));
    }
  }
  root.appendChild(addSection);

  const liveRowId = currentSetlistRowId(payload);
  const pinned = payload?.match?.viaOverride === true;

  const list = el('div', 'setlist-items');
  list.setAttribute('role', 'list');

  if (items.length === 0) {
    list.appendChild(
      el(
        'p',
        'setlist-empty',
        'No songs yet. Search the cue sheet to add songs you know or suspect are in tonight’s show.',
      ),
    );
  } else {
    items.forEach((item, index) => {
      const row = el('div', 'setlist-item');
      row.setAttribute('role', 'listitem');
      row.draggable = !busy;
      row.dataset.rowId = item.rowId;

      const isCurrent = liveRowId != null && liveRowId === String(item.rowId);
      if (isCurrent) row.classList.add('setlist-item--current');
      if (isCurrent && pinned) row.classList.add('setlist-item--pinned');
      if (item.missing) row.classList.add('setlist-item--missing');
      if (item.status === 'maybe') row.classList.add('setlist-item--maybe');
      else if (item.status === 'likely') row.classList.add('setlist-item--likely');

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', item.rowId);
        event.dataTransfer.effectAllowed = 'move';
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        const fromId = event.dataTransfer?.getData('text/plain');
        if (!fromId || fromId === item.rowId || !onReorder) return;
        const ids = items.map((it) => String(it.rowId));
        const from = ids.indexOf(String(fromId));
        const to = ids.indexOf(String(item.rowId));
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(to, 0, String(fromId));
        onReorder(ids);
      });

      const indexEl = el('div', 'setlist-item-index', String(index + 1));
      row.appendChild(indexEl);
      row.appendChild(renderKeyBadge(itemDisplayKey(item)));

      const body = el('div', 'setlist-item-body');
      const titleRowInner = el('div', 'setlist-item-title-row');
      titleRowInner.appendChild(el('div', 'setlist-item-title', itemDisplayTitle(item)));
      if (isCurrent) {
        titleRowInner.appendChild(el('span', 'setlist-badge setlist-badge--now', pinned ? 'Pinned now' : 'Now'));
      }
      if (item.missing) {
        titleRowInner.appendChild(el('span', 'setlist-badge setlist-badge--missing', 'Missing from sheet'));
      }
      body.appendChild(titleRowInner);

      const metaParts = [`Row ${item.rowId}`];
      if (item.subtitle) metaParts.push(item.subtitle);
      body.appendChild(el('div', 'setlist-item-meta', metaParts.join(' · ')));
      row.appendChild(body);

      const actions = el('div', 'setlist-item-actions');

      const status = el('select', 'setlist-status');
      status.setAttribute('aria-label', `Confidence for ${itemDisplayTitle(item)}`);
      status.disabled = busy;
      for (const value of SETLIST_STATUSES) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = STATUS_LABELS[value] ?? value;
        if (value === item.status) opt.selected = true;
        status.appendChild(opt);
      }
      status.addEventListener('change', () => onStatus?.(item.rowId, status.value));
      actions.appendChild(status);

      const upBtn = el('button', 'admin-editor-btn setlist-icon-btn', '↑');
      upBtn.type = 'button';
      upBtn.title = 'Move up';
      upBtn.disabled = busy || index === 0;
      upBtn.addEventListener('click', () => onMove?.(item.rowId, -1));
      actions.appendChild(upBtn);

      const downBtn = el('button', 'admin-editor-btn setlist-icon-btn', '↓');
      downBtn.type = 'button';
      downBtn.title = 'Move down';
      downBtn.disabled = busy || index === items.length - 1;
      downBtn.addEventListener('click', () => onMove?.(item.rowId, 1));
      actions.appendChild(downBtn);

      if (isCurrent && pinned && onClearPin) {
        const clearBtn = el('button', 'admin-editor-btn view-edit-btn--unpin', 'Clear pin');
        clearBtn.type = 'button';
        clearBtn.disabled = busy;
        clearBtn.title = 'Return the live board to automatic matching';
        clearBtn.addEventListener('click', () => onClearPin());
        actions.appendChild(clearBtn);
      } else if (!isCurrent && !item.missing && onPin) {
        const pinBtn = el('button', 'admin-editor-btn admin-editor-btn--primary', 'Pin');
        pinBtn.type = 'button';
        pinBtn.disabled = busy;
        pinBtn.title = 'Show this row as the live cue until the next automatic match';
        pinBtn.addEventListener('click', () => onPin(item.rowId));
        actions.appendChild(pinBtn);
      }

      const removeBtn = el('button', 'admin-editor-btn', 'Remove');
      removeBtn.type = 'button';
      removeBtn.disabled = busy;
      removeBtn.addEventListener('click', () => onRemove?.(item.rowId));
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  root.appendChild(list);

  queueMicrotask(() => {
    restoreSetlistFocus(root, focusRestore, { autoFocusSearch });
    scrollCurrentIntoView(root, liveRowId);
  });
}

let lastSetNavScrolledRowId = null;

export function resetSetNavScroll() {
  lastSetNavScrolledRowId = null;
}

/** Compact glance model for the admin dashboard set drawer. */
export function setNavModel(payload, setlist) {
  const items = Array.isArray(setlist?.items) ? setlist.items : [];
  const liveRowId = currentSetlistRowId(payload);
  const pinned = payload?.match?.viaOverride === true;
  return {
    name: setlist?.name ?? '',
    library: Array.isArray(setlist?.library) ? setlist.library : [],
    items: items.map((item, index) => {
      const rowId = String(item.rowId);
      const current = liveRowId != null && liveRowId === rowId;
      return {
        rowId,
        title: itemDisplayTitle(item),
        key: itemDisplayKey(item),
        index,
        current,
        pinned: current && pinned,
        missing: Boolean(item.missing),
        canPin: !current && !item.missing,
      };
    }),
  };
}

function scrollSetNavCurrent(root, liveRowId) {
  if (!liveRowId) {
    lastSetNavScrolledRowId = null;
    return;
  }
  if (liveRowId === lastSetNavScrolledRowId) return;
  lastSetNavScrolledRowId = liveRowId;
  root.querySelector('.set-nav-item--current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * Compact set navigator for the admin dashboard drawer.
 * Switch + pin + jump; full edit stays on the Set page.
 */
export function renderSetNav(root, ctx) {
  if (!root) return;
  const {
    payload,
    setlist,
    onSwitch,
    onPin,
    onClearPin,
    onOpenSet,
    busy = false,
  } = ctx;

  const model = setNavModel(payload, setlist);
  root.replaceChildren();
  root.classList.add('set-nav');

  const head = el('div', 'set-nav-head');
  const select = el('select', 'setlist-select set-nav-select');
  select.setAttribute('aria-label', 'Saved sets');
  select.disabled = busy || model.library.length === 0;
  if (model.library.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = model.name || 'No sets';
    select.appendChild(opt);
  } else {
    for (const entry of model.library) {
      const opt = document.createElement('option');
      opt.value = entry.name;
      const count = entry.itemCount != null ? ` (${entry.itemCount})` : '';
      opt.textContent = `${entry.name}${count}`;
      if (entry.name === model.name) opt.selected = true;
      select.appendChild(opt);
    }
  }
  select.addEventListener('change', () => {
    const name = select.value;
    if (name && name !== model.name) onSwitch?.(name);
  });
  head.appendChild(select);

  const open = el('a', 'set-nav-open', 'Open Set page');
  open.href = withKioskQuery('/views/setlist');
  if (typeof onOpenSet === 'function') {
    open.addEventListener('click', (event) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      event.preventDefault();
      onOpenSet(open.href);
    });
  }
  head.appendChild(open);
  root.appendChild(head);

  const list = el('div', 'set-nav-items');
  list.setAttribute('role', 'list');

  if (model.items.length === 0) {
    list.appendChild(el(
      'p',
      'set-nav-empty',
      'No songs on tonight’s set. Open the Set page to add them.',
    ));
  } else {
    for (const item of model.items) {
      const row = el('div', 'set-nav-item');
      row.setAttribute('role', 'listitem');
      if (item.current) row.classList.add('set-nav-item--current');
      if (item.pinned) row.classList.add('set-nav-item--pinned');
      if (item.missing) row.classList.add('set-nav-item--missing');

      row.appendChild(el('div', 'set-nav-item-index', String(item.index + 1)));
      row.appendChild(renderKeyBadge(item.key, 'setlist-item-key set-nav-item-key'));

      const body = el('div', 'set-nav-item-body');
      const titleRow = el('div', 'set-nav-item-title-row');
      titleRow.appendChild(el('div', 'set-nav-item-title', item.title));
      if (item.current) {
        titleRow.appendChild(el(
          'span',
          'setlist-badge setlist-badge--now',
          item.pinned ? 'Pinned now' : 'Now',
        ));
      }
      if (item.missing) {
        titleRow.appendChild(el('span', 'setlist-badge setlist-badge--missing', 'Missing'));
      }
      body.appendChild(titleRow);
      row.appendChild(body);

      if (item.current && item.pinned && onClearPin) {
        const clearBtn = el('button', 'admin-editor-btn view-edit-btn--unpin set-nav-item-btn', 'Clear');
        clearBtn.type = 'button';
        clearBtn.disabled = busy;
        clearBtn.title = 'Return the live board to automatic matching';
        clearBtn.addEventListener('click', () => onClearPin());
        row.appendChild(clearBtn);
      } else if (item.canPin && onPin) {
        const pinBtn = el('button', 'admin-editor-btn admin-editor-btn--primary set-nav-item-btn', 'Pin');
        pinBtn.type = 'button';
        pinBtn.disabled = busy;
        pinBtn.title = 'Show this row as the live cue until the next automatic match';
        pinBtn.addEventListener('click', () => onPin(item.rowId));
        row.appendChild(pinBtn);
      }

      list.appendChild(row);
    }
  }

  root.appendChild(list);

  const liveRowId = currentSetlistRowId(payload);
  queueMicrotask(() => {
    scrollSetNavCurrent(root, liveRowId);
  });
}
