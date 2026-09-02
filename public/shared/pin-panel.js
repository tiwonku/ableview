// Temporary pin picker: tonight's setlist first, then search the rest of the cue sheet.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function secondaryLabel(result) {
  const als = result.secondary?.find((s) => s.column === 'ALS Folder');
  if (als?.value) return als.value;
  if (result.aliases) return `Aliases: ${result.aliases}`;
  return '';
}

function haystackMatches(value, needle) {
  return String(value ?? '').toLowerCase().includes(needle);
}

function pinResultMatches(result, needle) {
  if (!needle) return true;
  if (haystackMatches(result.title, needle)) return true;
  if (haystackMatches(result.aliases, needle)) return true;
  return (result.secondary ?? []).some((s) => haystackMatches(s.value, needle));
}

/** Sheet-shaped cards from the active setlist (skip rows missing from the sheet). */
export function pinResultsFromSetlist(setlist) {
  const items = Array.isArray(setlist?.items) ? setlist.items : [];
  const results = [];
  for (const item of items) {
    if (item?.missing) continue;
    const rowId = item?.rowId != null ? String(item.rowId).trim() : '';
    if (!rowId) continue;
    results.push({
      rowId,
      title: String(item.liveTitle || item.title || '').trim() || `Row ${rowId}`,
      aliases: '',
      secondary: [],
      fromSetlist: true,
      status: item.status ?? null,
    });
  }
  return results;
}

function enrichSetlistResult(item, sheet) {
  if (!sheet) return { ...item, fromSetlist: true };
  return {
    ...sheet,
    rowId: item.rowId,
    title: String(sheet.title || item.title || '').trim() || item.title,
    fromSetlist: true,
    status: item.status ?? null,
  };
}

/**
 * Empty query → setlist cards in show order.
 * Typed query → matching setlist rows first, then other cue-sheet hits.
 */
export function mergePinResults({ query = '', setlist = null, sheetResults = [] } = {}) {
  const q = String(query ?? '').trim();
  const setlistItems = pinResultsFromSetlist(setlist);
  const sheetList = Array.isArray(sheetResults) ? sheetResults : [];
  const sheetById = new Map(sheetList.map((row) => [String(row.rowId), row]));

  if (!q) {
    return { results: setlistItems, source: 'setlist' };
  }

  const needle = q.toLowerCase();
  const ordered = [];
  const seen = new Set();

  for (const item of setlistItems) {
    const sheet = sheetById.get(item.rowId);
    if (!pinResultMatches(item, needle) && !sheet) continue;
    ordered.push(enrichSetlistResult(item, sheet));
    seen.add(item.rowId);
  }

  for (const sheet of sheetList) {
    const id = String(sheet.rowId);
    if (seen.has(id)) continue;
    ordered.push({ ...sheet, fromSetlist: false });
    seen.add(id);
  }

  return { results: ordered, source: 'sheet' };
}

export function createPinSession() {
  return {
    query: '',
    results: [],
    selectedRow: null,
    searching: false,
    source: 'setlist',
  };
}

/**
 * @param {HTMLElement} parent
 * @param {{
 *   query: string,
 *   results: Array,
 *   selectedRow: object|null,
 *   searching?: boolean,
 *   source?: 'setlist'|'sheet',
 *   setlistName?: string,
 *   saveState?: string,
 *   saveError?: string|null,
 *   onQueryChange: (q: string) => void,
 *   onSelectRow: (row: object) => void,
 *   onCancel: () => void,
 *   onSave: () => void,
 *   focusRestore?: { field: 'search'|'alias', start: number, end: number }|null,
 *   autoFocusSearch?: boolean,
 * }} opts
 */
export function renderPinPanel(parent, opts) {
  const {
    query,
    results = [],
    selectedRow = null,
    searching = false,
    source = 'setlist',
    setlistName = '',
    saveState = 'idle',
    saveError = null,
    onQueryChange,
    onSelectRow,
    onCancel,
    onSave,
    focusRestore = null,
    autoFocusSearch = false,
  } = opts;

  const section = el('section', 'alias-panel pin-panel');
  section.id = 'pin-panel';

  const header = el('div', 'alias-panel-header');
  header.appendChild(el('h2', 'alias-panel-title', 'Pin cue'));

  const actions = el('div', 'admin-editor-actions');
  const cancelBtn = el('button', 'admin-editor-btn', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.disabled = saveState === 'saving';
  cancelBtn.addEventListener('click', onCancel);
  actions.appendChild(cancelBtn);

  const pinBtn = el(
    'button',
    'admin-editor-btn admin-editor-btn--primary',
    saveState === 'saving' ? 'Pinning…' : 'Pin cue',
  );
  pinBtn.type = 'button';
  pinBtn.disabled = saveState === 'saving' || !selectedRow;
  pinBtn.addEventListener('click', onSave);
  actions.appendChild(pinBtn);
  header.appendChild(actions);
  section.appendChild(header);

  section.appendChild(
    el(
      'p',
      'alias-panel-context',
      'Show this sheet row as the live cue until the next automatic match. Starts with tonight’s set; search to pick any other sheet row. Replaces the current match if one is showing. Does not add an alias or change future matching.',
    ),
  );

  if (saveError) {
    section.appendChild(el('p', 'admin-editor-error', saveError));
  }

  const stepRow = el('div', 'alias-step');
  const label = source === 'setlist'
    ? (setlistName ? `Tonight’s set · ${setlistName}` : 'Tonight’s set')
    : 'Set + cue sheet';
  stepRow.appendChild(el('p', 'alias-step-label', label));

  const searchInput = el('input', 'alias-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search set or cue sheet…';
  searchInput.value = query ?? '';
  searchInput.autocomplete = 'off';
  searchInput.addEventListener('input', () => onQueryChange(searchInput.value));
  stepRow.appendChild(searchInput);

  const resultsList = el('div', 'alias-search-results');
  const q = String(query ?? '').trim();
  if (searching && !results.length) {
    resultsList.appendChild(el('p', 'alias-search-empty', 'Searching…'));
  } else if (!results.length) {
    resultsList.appendChild(
      el(
        'p',
        'alias-search-empty',
        q
          ? 'No rows matched.'
          : 'No songs on tonight’s set. Search the cue sheet to pin another row.',
      ),
    );
  } else {
    const showSetlistBadge = source === 'sheet';
    for (const result of results) {
      const btn = el('button', 'alias-search-result');
      btn.type = 'button';
      if (selectedRow?.rowId === result.rowId) btn.classList.add('is-selected');
      btn.addEventListener('click', () => onSelectRow(result));

      btn.appendChild(el('span', 'alias-search-result-title', result.title));
      const parts = [];
      if (showSetlistBadge && result.fromSetlist) parts.push('On set');
      parts.push(`Row ${result.rowId}`);
      const sub = secondaryLabel(result);
      if (sub) parts.push(sub);
      btn.appendChild(el('span', 'alias-search-result-meta', parts.join(' · ')));
      resultsList.appendChild(btn);
    }
    if (searching) {
      resultsList.appendChild(el('p', 'alias-search-empty', 'Searching cue sheet…'));
    }
  }
  stepRow.appendChild(resultsList);

  if (selectedRow) {
    stepRow.appendChild(
      el('p', 'alias-selected-row', `Selected: ${selectedRow.title} (row ${selectedRow.rowId})`),
    );
  }
  section.appendChild(stepRow);
  parent.appendChild(section);

  queueMicrotask(() => {
    const input = section.querySelector('.alias-search-input');
    if (!input) return;
    if (focusRestore?.field === 'search') {
      input.focus();
      input.setSelectionRange(focusRestore.start, focusRestore.end);
      return;
    }
    if (autoFocusSearch) {
      input.focus();
      input.select?.();
    }
  });
}
