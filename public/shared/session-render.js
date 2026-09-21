// Session view: watched tracks + per-track match confidence + alias linking.

import { setConnectionState } from './view-render.js';
import { renderAliasPanel } from './alias-panel.js';
import { renderRowEditorPanel } from './admin-row-editor.js';
import { prependDopeButton } from './moment-controls.js';
import { renderSceneBanner, renderSessionTracks } from './session-tracks.js';

/**
 * @param {HTMLElement} root
 * @param {{
 *   title?: string,
 *   payload?: object|null,
 *   connected?: boolean,
 *   lastUpdate?: Date|null,
 *   aliasSession?: object|null,
 *   aliasPanel?: object|null,
 *   editSession?: object|null,
 *   editorColumns?: object,
 *   saveState?: string,
 *   saveError?: string|null,
 *   onStartAlias?: (clipName: string, track?: object) => void,
 *   onStartCreate?: (clipName: string, track?: object) => void,
 *   onPinRow?: (rowId: string) => void,
 *   onCancelEdit?: Function,
 *   onSaveEdit?: Function,
 * }} ctx
 */
export function renderSession(root, ctx) {
  const {
    title,
    payload,
    connected,
    lastUpdate,
    aliasSession = null,
    aliasPanel = null,
    editSession = null,
    editorColumns = {},
    saveState = 'idle',
    saveError = null,
    onStartAlias,
    onStartCreate,
    onPinRow,
    onCancelEdit,
    onSaveEdit,
    getMomentWho = null,
  } = ctx;

  setConnectionState(connected, lastUpdate, payload);

  root.replaceChildren();
  root.className = 'session-main';

  const heading = document.createElement('h1');
  heading.className = 'view-title';
  heading.textContent = title || 'Session';

  const titleRow = document.createElement('div');
  titleRow.className = 'view-title-row';
  titleRow.appendChild(heading);
  if (getMomentWho != null) {
    const actions = document.createElement('div');
    actions.className = 'view-edit-actions';
    prependDopeButton(actions, getMomentWho);
    titleRow.appendChild(actions);
  }
  root.appendChild(titleRow);

  renderSceneBanner(root, payload);

  if (aliasSession && aliasPanel) {
    renderAliasPanel(root, aliasPanel);
  } else if (editSession && onCancelEdit && onSaveEdit) {
    renderRowEditorPanel(root, {
      session: editSession,
      editorColumns,
      livePayload: payload,
      onCancel: onCancelEdit,
      onSave: onSaveEdit,
      saveState,
      saveError,
      panelId: 'session-row-panel',
    });
    root.querySelector('#session-row-panel')?.scrollIntoView({ block: 'nearest' });
  }

  renderSessionTracks(root, {
    payload,
    aliasSession,
    editSession,
    onStartAlias,
    onStartCreate,
    onPinRow,
  });
}
