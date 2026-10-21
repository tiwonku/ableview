// Modal editor for one setlist row. Stays over the Set page; does not replace it.

import { renderRowEditorPanel, updateEditContextBanner } from './admin-row-editor.js';
import { closeColorPicker } from './color-picker.js';

/** @type {HTMLElement | null} */
let overlay = null;
/** @type {null | {
 *   title: string,
 *   rowId: string,
 *   loading: boolean,
 *   saving: boolean,
 *   error: string|null,
 *   session: object|null,
 *   editorColumns: object,
 *   fieldLabels: object,
 *   livePayload: object|null,
 *   onSave: ((section: HTMLElement) => Promise<void>)|null,
 *   onClose: (() => void)|null,
 *   focusRestore: HTMLElement|null,
 * }} */
let state = null;

export function setlistRowModalOpen() {
  return state != null;
}

export function setlistRowModalRowId() {
  return state?.rowId ?? null;
}

export function closeSetlistRowModal() {
  dismiss();
}

export function syncSetlistRowModalContext(livePayload) {
  if (!state?.session || !overlay || overlay.hidden) return;
  state.livePayload = livePayload ?? null;
  updateEditContextBanner(overlay, state.session, state.livePayload);
}

/**
 * Open or update the setlist row editor. Later calls merge into the open modal
 * so a save-state change does not rebuild the form.
 */
export function openSetlistRowModal(next = {}) {
  const el = ensureOverlay();
  const focusRestore = state?.focusRestore
    ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  state = {
    title: '',
    rowId: '',
    loading: false,
    saving: false,
    error: null,
    session: null,
    editorColumns: {},
    fieldLabels: {},
    livePayload: null,
    onSave: null,
    onClose: null,
    ...(state ?? {}),
    ...next,
    focusRestore,
  };
  el.hidden = false;
  document.body.classList.add('setlist-row-modal-open');
  paint(el);
}

function requestClose() {
  if (state?.saving) return;
  const onClose = state?.onClose;
  dismiss();
  onClose?.();
}

function dismiss() {
  closeColorPicker();
  const current = state;
  state = null;
  if (overlay) {
    overlay.hidden = true;
    const body = overlay.querySelector('[data-role="setlist-row-modal-body"]');
    if (body) {
      body.replaceChildren();
      delete body.dataset.rowId;
    }
  }
  document.body.classList.remove('setlist-row-modal-open');
  current?.focusRestore?.focus?.();
}

function ensureOverlay() {
  if (overlay) return overlay;

  const root = document.createElement('div');
  root.className = 'setlist-row-modal';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'setlist-row-modal-title');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'setlist-row-modal-backdrop';
  backdrop.dataset.role = 'setlist-row-modal-backdrop';
  backdrop.setAttribute('aria-label', 'Close cue editor');
  backdrop.addEventListener('click', () => requestClose());
  root.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'setlist-row-modal-panel';
  panel.dataset.role = 'setlist-row-modal-panel';

  const header = document.createElement('div');
  header.className = 'setlist-row-modal-header';

  const heading = document.createElement('div');
  heading.className = 'setlist-row-modal-heading';
  const title = document.createElement('h2');
  title.className = 'setlist-row-modal-title';
  title.id = 'setlist-row-modal-title';
  const meta = document.createElement('p');
  meta.className = 'setlist-row-modal-meta';
  meta.dataset.role = 'setlist-row-modal-meta';
  heading.append(title, meta);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'setlist-row-modal-close';
  closeBtn.dataset.role = 'setlist-row-modal-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => requestClose());

  header.append(heading, closeBtn);
  panel.appendChild(header);

  const error = document.createElement('p');
  error.className = 'admin-editor-error setlist-row-modal-error';
  error.dataset.role = 'setlist-row-modal-error';
  error.hidden = true;
  panel.appendChild(error);

  const body = document.createElement('div');
  body.className = 'setlist-row-modal-body';
  body.dataset.role = 'setlist-row-modal-body';
  panel.appendChild(body);

  root.appendChild(panel);
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    requestClose();
  });

  document.body.appendChild(root);
  overlay = root;
  return overlay;
}

function paint(root) {
  if (!state) return;
  const title = root.querySelector('#setlist-row-modal-title');
  const meta = root.querySelector('[data-role="setlist-row-modal-meta"]');
  const error = root.querySelector('[data-role="setlist-row-modal-error"]');
  const closeBtn = root.querySelector('[data-role="setlist-row-modal-close"]');
  const backdrop = root.querySelector('[data-role="setlist-row-modal-backdrop"]');
  const body = root.querySelector('[data-role="setlist-row-modal-body"]');
  const panel = root.querySelector('[data-role="setlist-row-modal-panel"]');
  if (!title || !meta || !error || !closeBtn || !body) return;

  title.textContent = state.title || 'Edit cue';
  meta.textContent = state.rowId ? `Cue sheet · row ${state.rowId}` : 'Cue sheet';
  error.hidden = !state.error;
  error.textContent = state.error ?? '';
  closeBtn.disabled = state.saving;
  if (backdrop) backdrop.disabled = state.saving;
  if (panel) panel.setAttribute('aria-busy', state.loading || state.saving ? 'true' : 'false');

  const formReady = Boolean(
    state.session
    && body.dataset.rowId === String(state.session.rowId)
    && body.querySelector('.row-editor'),
  );

  if (state.loading) {
    body.replaceChildren();
    delete body.dataset.rowId;
    const status = document.createElement('p');
    status.className = 'setlist-row-modal-status';
    status.textContent = 'Loading cue row…';
    body.appendChild(status);
    return;
  }

  if (!state.session) {
    body.replaceChildren();
    delete body.dataset.rowId;
    return;
  }

  if (formReady) {
    const saveBtn = body.querySelector('.admin-editor-btn--primary');
    const cancelBtn = body.querySelector('.admin-editor-actions .admin-editor-btn:not(.admin-editor-btn--primary)');
    if (saveBtn) {
      saveBtn.disabled = state.saving;
      saveBtn.textContent = state.saving ? 'Saving…' : 'Save';
    }
    if (cancelBtn) cancelBtn.disabled = state.saving;
    updateEditContextBanner(root, state.session, state.livePayload);
    return;
  }

  body.replaceChildren();
  body.dataset.rowId = String(state.session.rowId);
  renderRowEditorPanel(body, {
    session: state.session,
    editorColumns: state.editorColumns,
    fieldLabels: state.fieldLabels,
    panelId: 'setlist-row-editor',
    livePayload: state.livePayload,
    onCancel: () => requestClose(),
    onSave: (section) => submit(section),
    saveState: state.saving ? 'saving' : 'idle',
    saveError: null,
  });
  const focusTarget = body.querySelector('textarea, input.row-editor-input');
  focusTarget?.focus?.();
}

async function submit(section) {
  if (!state || state.saving || typeof state.onSave !== 'function') return;
  const save = state.onSave;
  state.saving = true;
  state.error = null;
  if (overlay) paint(overlay);
  try {
    await save(section);
  } catch (err) {
    if (!state) return;
    state.saving = false;
    state.error = err.message ?? 'Save failed';
    if (overlay) paint(overlay);
  }
}
