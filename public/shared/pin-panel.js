// Temporary pin picker: search the cue sheet and hold that row until the next auto match.

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

export function createPinSession() {
  return {
    query: '',
    results: [],
    selectedRow: null,
    searching: false,
  };
}

/**
 * @param {HTMLElement} parent
 * @param {{
 *   query: string,
 *   results: Array,
 *   selectedRow: object|null,
 *   searching?: boolean,
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
      'Show this sheet row as the live cue until the next automatic match. Does not add an alias or change future matching.',
    ),
  );

  if (saveError) {
    section.appendChild(el('p', 'admin-editor-error', saveError));
  }

  const stepRow = el('div', 'alias-step');
  stepRow.appendChild(el('p', 'alias-step-label', 'Find the sheet row'));

  const searchInput = el('input', 'alias-search-input');
  searchInput.type = 'search';
  searchInput.placeholder = 'Search song title, aliases, ALS folder…';
  searchInput.value = query ?? '';
  searchInput.autocomplete = 'off';
  searchInput.addEventListener('input', () => onQueryChange(searchInput.value));
  stepRow.appendChild(searchInput);

  const resultsList = el('div', 'alias-search-results');
  if (searching) {
    resultsList.appendChild(el('p', 'alias-search-empty', 'Searching…'));
  } else if (!results.length) {
    resultsList.appendChild(
      el('p', 'alias-search-empty', String(query ?? '').trim() ? 'No rows matched.' : 'Type to search the cue sheet.'),
    );
  } else {
    for (const result of results) {
      const btn = el('button', 'alias-search-result');
      btn.type = 'button';
      if (selectedRow?.rowId === result.rowId) btn.classList.add('is-selected');
      btn.addEventListener('click', () => onSelectRow(result));

      btn.appendChild(el('span', 'alias-search-result-title', result.title));
      const meta = el('span', 'alias-search-result-meta', `Row ${result.rowId}`);
      const sub = secondaryLabel(result);
      if (sub) meta.textContent += ` · ${sub}`;
      btn.appendChild(meta);
      resultsList.appendChild(btn);
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
