// Setlist view: night-specific ordered sheet rows. Glance + pin override; not a match source.

import { setConnectionState } from './view-render.js';
import { resolveMatchedTitle } from './playing-clips-strip.js';

export const SETLIST_STATUSES = Object.freeze(['confirmed', 'likely', 'maybe']);

const STATUS_LABELS = {
  confirmed: 'Confirmed',
  likely: 'Likely',
  maybe: 'Maybe',
};

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

function liveBanner(payload, matchColumn) {
  const matched = payload?.match?.matched === true;
  const pinned = payload?.match?.viaOverride === true;
  if (!payload) {
    return { text: 'Waiting for live cue…', tone: 'idle' };
  }
  if (!matched) {
    const clip = payload.clipName?.trim();
    return {
      text: clip
        ? `Live board: no confident match · ${clip}`
        : 'Live board: no confident match',
      tone: 'nomatch',
    };
  }
  const title = resolveMatchedTitle(payload, matchColumn) || payload.match?.matchedValue || 'Matched';
  return {
    text: pinned ? `Live board (pinned): ${title}` : `Live board: ${title}`,
    tone: pinned ? 'pinned' : 'live',
  };
}

function secondaryLabel(result) {
  const als = result.secondary?.find((s) => s.column === 'ALS Folder');
  if (als?.value) return als.value;
  if (result.aliases) return `Aliases: ${result.aliases}`;
  return '';
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   title?: string,
 *   payload?: object|null,
 *   setlist?: object|null,
 *   matchColumn?: string|null,
 *   connected?: boolean,
 *   lastUpdate?: Date|null,
 *   addQuery?: string,
 *   addResults?: Array,
 *   addSearching?: boolean,
 *   nameDraft?: string,
 *   saveState?: string,
 *   saveError?: string|null,
 *   focusRestore?: object|null,
 *   autoFocusSearch?: boolean,
 *   onAddQueryChange?: (q: string) => void,
 *   onAddRow?: (row: object) => void,
 *   onRemove?: (rowId: string) => void,
 *   onStatus?: (rowId: string, status: string) => void,
 *   onMove?: (rowId: string, direction: -1|1) => void,
 *   onReorder?: (rowIds: string[]) => void,
 *   onSwitch?: (name: string) => void,
 *   onCreate?: (name: string) => void,
 *   onDuplicate?: (name: string) => void,
 *   onNameDraftChange?: (name: string) => void,
 *   onPin?: (rowId: string) => void,
 *   onClearPin?: () => void,
 * }} ctx
 */
export function renderSetlist(root, ctx) {
  const {
    title,
    payload,
    setlist,
    matchColumn = null,
    connected,
    lastUpdate,
    addQuery = '',
    addResults = [],
    addSearching = false,
    nameDraft = '',
    saveState = 'idle',
    saveError = null,
    focusRestore = null,
    autoFocusSearch = false,
    onAddQueryChange,
    onAddRow,
    onRemove,
    onStatus,
    onMove,
    onReorder,
    onSwitch,
    onCreate,
    onDuplicate,
    onNameDraftChange,
    onPin,
    onClearPin,
  } = ctx;

  setConnectionState(connected, lastUpdate, payload);

  root.replaceChildren();
  root.className = 'setlist-main';

  const heading = el('h1', 'view-title', title || 'Setlist');
  root.appendChild(heading);

  const banner = liveBanner(payload, matchColumn);
  const bannerEl = el('div', `setlist-live setlist-live--${banner.tone}`, banner.text);
  root.appendChild(bannerEl);

  const hint = el(
    'p',
    'setlist-hint',
    'This list is tonight’s plan — it does not change matching. Pin only when you want this row on the live board until the next automatic match.',
  );
  root.appendChild(hint);

  const toolbar = el('div', 'setlist-toolbar');

  const library = Array.isArray(setlist?.library) ? setlist.library : [];
  const currentName = setlist?.name ?? '';
  const busy = saveState === 'saving';

  const select = el('select', 'setlist-select');
  select.dataset.setlistField = 'library';
  select.setAttribute('aria-label', 'Saved setlists');
  select.disabled = busy || library.length === 0;
  if (library.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = currentName || 'No setlists';
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
  nameInput.placeholder = 'New setlist name';
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

  root.appendChild(toolbar);

  if (saveError) {
    root.appendChild(el('p', 'admin-editor-error', saveError));
  }

  const addSection = el('section', 'setlist-add');
  addSection.appendChild(el('p', 'setlist-add-label', 'Add from cue sheet'));

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
  const onList = new Set((setlist?.items ?? []).map((item) => String(item.rowId)));
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
      btn.appendChild(el('span', 'alias-search-result-title', result.title));
      const meta = el(
        'span',
        'alias-search-result-meta',
        already ? `Already on setlist · Row ${result.rowId}` : `Row ${result.rowId}`,
      );
      const sub = secondaryLabel(result);
      if (sub && !already) meta.textContent += ` · ${sub}`;
      btn.appendChild(meta);
      resultsList.appendChild(btn);
    }
  }
  addSection.appendChild(resultsList);
  root.appendChild(addSection);

  const items = Array.isArray(setlist?.items) ? setlist.items : [];
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

      const body = el('div', 'setlist-item-body');
      const titleRow = el('div', 'setlist-item-title-row');
      titleRow.appendChild(el('div', 'setlist-item-title', itemDisplayTitle(item)));
      if (isCurrent) {
        titleRow.appendChild(el('span', 'setlist-badge setlist-badge--now', pinned ? 'Pinned now' : 'Now'));
      }
      if (item.missing) {
        titleRow.appendChild(el('span', 'setlist-badge setlist-badge--missing', 'Missing from sheet'));
      }
      body.appendChild(titleRow);

      const meta = el('div', 'setlist-item-meta', `Row ${item.rowId}`);
      body.appendChild(meta);
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
  });
}
