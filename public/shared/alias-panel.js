// Add-as-alias panel: pick sheet row + alias stem from the live clip name.

import {
  aliasFromTokenPrefix,
  aliasWouldMatchClip,
  suggestAliasStem,
  tokenizeClipName,
} from './alias-stem.js';

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

/**
 * @param {HTMLElement} parent
 * @param {{
 *   clipName: string,
 *   trackLabel?: string|null,
 *   aliasText: string,
 *   query: string,
 *   results: Array,
 *   selectedRow: object|null,
 *   aliasColumnPresent: boolean|null,
 *   aliasColumn: string|null,
 *   searching?: boolean,
 *   saveState?: string,
 *   saveError?: string|null,
 *   onQueryChange: (q: string) => void,
 *   onSelectRow: (row: object) => void,
 *   onAliasChange: (alias: string) => void,
 *   onCancel: () => void,
 *   onSave: () => void,
 * }} opts
 */
export function renderAliasPanel(parent, opts) {
  const {
    clipName,
    trackLabel = null,
    aliasText,
    query,
    results = [],
    selectedRow = null,
    aliasColumnPresent = null,
    aliasColumn = 'Aliases',
    searching = false,
    saveState = 'idle',
    saveError = null,
    onQueryChange,
    onSelectRow,
    onAliasChange,
    onCancel,
    onSave,
  } = opts;

  const section = el('section', 'alias-panel');
  section.id = 'alias-panel';

  const header = el('div', 'alias-panel-header');
  header.appendChild(el('h2', 'alias-panel-title', 'Add as alias'));

  const actions = el('div', 'admin-editor-actions');
  const cancelBtn = el('button', 'admin-editor-btn', 'Cancel');
  cancelBtn.type = 'button';
  cancelBtn.disabled = saveState === 'saving';
  cancelBtn.addEventListener('click', onCancel);
  actions.appendChild(cancelBtn);

  const saveBtn = el('button', 'admin-editor-btn admin-editor-btn--primary', saveState === 'saving' ? 'Saving…' : 'Save alias');
  saveBtn.type = 'button';
  saveBtn.disabled =
    saveState === 'saving'
    || !selectedRow
    || !String(aliasText ?? '').trim()
    || aliasColumnPresent === false;
  saveBtn.addEventListener('click', onSave);
  actions.appendChild(saveBtn);
  header.appendChild(actions);
  section.appendChild(header);

  section.appendChild(
    el(
      'p',
      'alias-panel-context',
      opts.trackLabel
        ? `Link ${opts.trackLabel} clip "${clipName}" to an existing cue row via the ${aliasColumn || 'Aliases'} column.`
        : `Link clip "${clipName}" to an existing cue row via the ${aliasColumn || 'Aliases'} column.`
    )
  );

  if (aliasColumnPresent === false) {
    section.appendChild(
      el(
        'p',
        'admin-editor-error',
        `Aliases column "${aliasColumn || 'Aliases'}" not found on the sheet. Add that header, sync, then try again.`
      )
    );
  }

  if (saveError) {
    section.appendChild(el('p', 'admin-editor-error', saveError));
  }

  // Step 1 — row search
  const stepRow = el('div', 'alias-step');
  stepRow.appendChild(el('p', 'alias-step-label', '1. Find the sheet row'));

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
      el('p', 'alias-search-empty', query.trim() ? 'No rows matched.' : 'Type to search the cue sheet.')
    );
  } else {
    for (const result of results) {
      const btn = el('button', 'alias-search-result');
      btn.type = 'button';
      if (selectedRow?.rowId === result.rowId) btn.classList.add('is-selected');
      btn.addEventListener('click', () => onSelectRow(result));

      const title = el('span', 'alias-search-result-title', result.title);
      btn.appendChild(title);
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
      el('p', 'alias-selected-row', `Selected: ${selectedRow.title} (row ${selectedRow.rowId})`)
    );
  }
  section.appendChild(stepRow);

  // Step 2 — alias stem
  const stepAlias = el('div', 'alias-step');
  stepAlias.appendChild(el('p', 'alias-step-label', '2. Alias text (usually the song stem)'));

  const tokens = tokenizeClipName(clipName);
  if (tokens.some((t) => t.selectable)) {
    const chips = el('div', 'alias-token-chips');
    chips.appendChild(el('span', 'alias-token-label', 'Clip:'));
    tokens.forEach((token, index) => {
      if (!token.selectable) {
        chips.appendChild(el('span', 'alias-token-delim', token.text));
        return;
      }
      const chip = el('button', 'alias-token-chip', token.text);
      chip.type = 'button';
      const prefix = aliasFromTokenPrefix(tokens, index);
      if (prefix === aliasText) chip.classList.add('is-selected');
      chip.title = `Use “${prefix}” as alias`;
      chip.addEventListener('click', () => onAliasChange(prefix));
      chips.appendChild(chip);
    });
    stepAlias.appendChild(chips);
  }

  const aliasInput = el('input', 'alias-text-input');
  aliasInput.type = 'text';
  aliasInput.value = aliasText ?? '';
  aliasInput.placeholder = suggestAliasStem(clipName) || 'Alias';
  aliasInput.addEventListener('input', () => onAliasChange(aliasInput.value));
  stepAlias.appendChild(aliasInput);

  stepAlias.appendChild(
    el(
      'p',
      'alias-help',
      'Clips that start with this alias (after ignoring punctuation) match this row — e.g. HotRox_ DRUMS and HotRox_ SAMPLES both match alias HotRox.'
    )
  );

  const preview = el('p', 'alias-preview');
  const trimmedAlias = String(aliasText ?? '').trim();
  if (!trimmedAlias) {
    preview.textContent = 'Will match this clip: —';
    preview.classList.add('is-muted');
  } else if (aliasWouldMatchClip(trimmedAlias, clipName)) {
    preview.textContent = 'Will match this clip: Yes';
    preview.classList.add('is-ok');
  } else {
    preview.textContent =
      'Will match this clip: Maybe (fuzzy only) — prefer a shorter stem that the clip starts with.';
    preview.classList.add('is-warn');
  }
  stepAlias.appendChild(preview);

  section.appendChild(stepAlias);
  parent.appendChild(section);

  queueMicrotask(() => {
    if (document.activeElement?.tagName === 'INPUT') return;
    searchInput.focus();
    searchInput.select?.();
  });
}

export function createAliasSession(clipName, { trackName = null, trackIndex = null } = {}) {
  const name = String(clipName ?? '').trim();
  const trackLabel = trackName?.trim()
    || (trackIndex != null ? `track ${trackIndex}` : null);
  return {
    clipName: name,
    trackName: trackName ?? null,
    trackIndex: trackIndex ?? null,
    trackLabel,
    aliasText: suggestAliasStem(name),
    query: suggestAliasStem(name),
    results: [],
    selectedRow: null,
    aliasColumnPresent: null,
    aliasColumn: 'Aliases',
    searching: false,
  };
}
