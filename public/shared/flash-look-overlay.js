// Confirm overlay: write live GrandMA RGB onto the matched cue row.

import { applyColorSwatchStyle } from './color-parse.js';
import { flashLookChangesForColumns, flashLookWarnings } from './flash-look.js';

/** @type {HTMLElement | null} */
let overlay = null;
/** @type {null | {
 *   rowId: string,
 *   slots: object[],
 *   onWrite: (payload: { rowId: string, changes: object, columns: string[] }) => Promise<{ ok?: boolean, error?: string }>,
 *   focusRestore: Element | null,
 *   saving: boolean,
 * }} */
let session = null;

export function closeFlashLook() {
  dismiss({ restore: false });
}

export function flashLookRowId() {
  return session?.rowId ?? null;
}

export function abortFlashLookIfRowChanged(rowId) {
  if (!session) return false;
  if (String(session.rowId) === String(rowId ?? '')) return false;
  dismiss({ restore: false });
  return true;
}

export function openFlashLook({
  rowId,
  cueTitle = 'this cue',
  slots = [],
  moving = false,
  onWrite,
} = {}) {
  dismiss({ restore: false });
  if (rowId == null || rowId === '') return false;

  const el = ensureOverlay();
  session = {
    rowId: String(rowId),
    slots,
    onWrite,
    focusRestore: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    saving: false,
  };

  paint(el, { cueTitle, slots, moving });
  el.hidden = false;
  document.body.classList.add('flash-look-open');
  const writeAll = el.querySelector('[data-role="flash-look-write-all"]');
  if (writeAll instanceof HTMLElement && !writeAll.disabled) writeAll.focus();
  else el.querySelector('[data-role="flash-look-cancel"]')?.focus?.();
  return true;
}

function dismiss({ restore }) {
  const current = session;
  session = null;
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('flash-look-open');
  if (!current) return;
  if (restore) current.focusRestore?.focus?.();
}

function ensureOverlay() {
  if (overlay) return overlay;

  const root = document.createElement('div');
  root.className = 'flash-look-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'flash-look-title');
  root.tabIndex = -1;

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'flash-look-backdrop';
  backdrop.setAttribute('aria-label', 'Cancel Flash look');
  backdrop.addEventListener('click', () => {
    if (session?.saving) return;
    dismiss({ restore: true });
  });
  root.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'flash-look-panel';
  panel.dataset.role = 'flash-look-panel';
  root.appendChild(panel);

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (session?.saving) return;
      dismiss({ restore: true });
    }
  });

  document.body.appendChild(root);
  overlay = root;
  return overlay;
}

function paint(root, { cueTitle, slots, moving }) {
  const panel = root.querySelector('[data-role="flash-look-panel"]');
  if (!panel) return;
  panel.replaceChildren();

  const writable = (slots ?? []).filter((s) => s.canWrite);
  const warnings = flashLookWarnings(slots, { moving });

  const header = document.createElement('div');
  header.className = 'flash-look-header';

  const titles = document.createElement('div');
  titles.className = 'flash-look-titles';

  const kicker = document.createElement('p');
  kicker.className = 'flash-look-kicker';
  kicker.textContent = 'Flash look';
  titles.appendChild(kicker);

  const title = document.createElement('h2');
  title.className = 'flash-look-title';
  title.id = 'flash-look-title';
  title.textContent = cueTitle?.trim() ? `onto ${cueTitle.trim()}` : 'onto this cue';
  titles.appendChild(title);
  header.appendChild(titles);
  panel.appendChild(header);

  const compare = document.createElement('div');
  compare.className = 'flash-look-compare';
  compare.appendChild(renderSide({
    kicker: 'Sheet now',
    slots,
    live: false,
  }));

  const arrow = document.createElement('p');
  arrow.className = 'flash-look-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  compare.appendChild(arrow);

  compare.appendChild(renderSide({
    kicker: 'GrandMA now',
    slots,
    live: true,
  }));
  panel.appendChild(compare);

  const hint = document.createElement('p');
  hint.className = 'flash-look-hint';
  hint.textContent = writable.length
    ? 'Tap a GrandMA swatch to write just that slot.'
    : 'No live GrandMA colors to write.';
  panel.appendChild(hint);

  if (warnings.length) {
    const warn = document.createElement('p');
    warn.className = 'flash-look-warn';
    warn.dataset.role = 'flash-look-warn';
    warn.textContent = warnings.join(' ');
    panel.appendChild(warn);
  }

  const error = document.createElement('p');
  error.className = 'flash-look-error';
  error.dataset.role = 'flash-look-error';
  error.hidden = true;
  panel.appendChild(error);

  const actions = document.createElement('div');
  actions.className = 'flash-look-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'flash-look-btn';
  cancel.dataset.role = 'flash-look-cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    if (session?.saving) return;
    dismiss({ restore: true });
  });
  actions.appendChild(cancel);

  const writeAll = document.createElement('button');
  writeAll.type = 'button';
  writeAll.className = 'flash-look-btn flash-look-btn--primary';
  writeAll.dataset.role = 'flash-look-write-all';
  writeAll.disabled = writable.length === 0;
  writeAll.textContent = writable.length <= 1
    ? 'Write look'
    : `Write all ${writable.length}`;
  writeAll.addEventListener('click', () => {
    submit(writable.map((s) => s.column));
  });
  actions.appendChild(writeAll);
  panel.appendChild(actions);
}

function renderSide({ kicker, slots, live }) {
  const side = document.createElement('div');
  side.className = 'flash-look-side' + (live ? ' flash-look-side--live' : '');

  const label = document.createElement('p');
  label.className = 'flash-look-side-kicker';
  label.textContent = kicker;
  side.appendChild(label);

  const row = document.createElement('div');
  row.className = 'flash-look-slots';
  row.style.gridTemplateColumns = `repeat(${Math.max((slots ?? []).length, 1)}, minmax(0, 1fr))`;
  for (const slot of slots ?? []) {
    row.appendChild(renderChip(slot, live));
  }
  side.appendChild(row);
  return side;
}

function renderChip(slot, live) {
  const color = live ? slot.live : slot.sheet;
  const clickable = live && slot.canWrite;
  const el = document.createElement(clickable ? 'button' : 'div');
  if (clickable) {
    el.type = 'button';
    el.addEventListener('click', () => submit([slot.column]));
  }
  el.className = 'flash-look-chip';
  if (live) el.className += ' flash-look-chip--live';
  if (!color) el.classList.add('flash-look-chip--empty');
  if (clickable) {
    el.title = `Write ${slot.label} from GrandMA`;
    el.setAttribute('aria-label', `Write ${slot.label} from GrandMA`);
  }

  const name = document.createElement('span');
  name.className = 'flash-look-chip-label';
  name.textContent = slot.label;
  el.appendChild(name);

  const swatch = document.createElement('span');
  swatch.className = 'color-swatch flash-look-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  applyColorSwatchStyle(swatch, color);
  el.appendChild(swatch);

  const meta = document.createElement('span');
  meta.className = 'flash-look-chip-meta';
  meta.textContent = color?.rgbText ?? '—';
  el.appendChild(meta);
  return el;
}

async function submit(columns) {
  if (!session || session.saving) return;
  const changes = flashLookChangesForColumns(session.slots, columns);
  if (!Object.keys(changes).length) return;

  session.saving = true;
  setBusy(true);
  setError('');

  let result = { ok: false, error: 'Save failed' };
  try {
    result = await session.onWrite?.({
      rowId: session.rowId,
      changes,
      columns,
    }) ?? result;
  } catch (err) {
    result = { ok: false, error: err?.message ?? 'Save failed' };
  }

  if (!session) return;
  if (result?.ok) {
    dismiss({ restore: true });
    return;
  }
  session.saving = false;
  setBusy(false);
  setError(result?.error ?? 'Save failed');
}

function setBusy(busy) {
  if (!overlay) return;
  overlay.classList.toggle('flash-look-overlay--busy', busy);

  const writable = (session?.slots ?? []).some((s) => s.canWrite);
  const writeAll = overlay.querySelector('[data-role="flash-look-write-all"]');
  const cancel = overlay.querySelector('[data-role="flash-look-cancel"]');
  const backdrop = overlay.querySelector('.flash-look-backdrop');
  if (cancel) cancel.disabled = busy;
  if (backdrop) backdrop.disabled = busy;
  if (writeAll) {
    writeAll.disabled = busy || !writable;
    const count = (session?.slots ?? []).filter((s) => s.canWrite).length;
    writeAll.textContent = busy
      ? 'Writing…'
      : count <= 1
        ? 'Write look'
        : `Write all ${count}`;
  }
  for (const chip of overlay.querySelectorAll('button.flash-look-chip--live')) {
    chip.disabled = busy;
  }
}

function setError(message) {
  const el = overlay?.querySelector('[data-role="flash-look-error"]');
  if (!el) return;
  const text = String(message ?? '').trim();
  el.hidden = !text;
  el.textContent = text;
}

export function syncFlashLookButton(root, { ready = false, title = '' } = {}) {
  const btn = root?.querySelector('[data-role="flash-look"]');
  if (!btn) return;
  btn.disabled = !ready;
  if (title) btn.title = title;
}
