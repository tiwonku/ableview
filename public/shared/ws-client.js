// Shared WebSocket client (NFR-6). Auto-reconnect + connection/last-update display.

import {
  renderView,
  renderAdmin,
  updateAdminLiveChrome,
  captureEditSession,
  setConnectionState,
} from './view-render.js';
import { collectEditorChanges } from './admin-row-editor.js';
import { mountViewNav } from './view-nav.js';

const RECONNECT_MS = 1500;

export function connectView({
  viewId,
  rootSelector = '#app',
  statusOnly = false,
  settingsActive = false,
  onPayload = null,
  onSimModeChange = null,
}) {
  const root = statusOnly ? null : document.querySelector(rootSelector);
  if (!statusOnly && !root) throw new Error(`Missing root element: ${rootSelector}`);

  let ws = null;
  let reconnectTimer = null;
  let viewConfig = null;
  let viewsList = null;
  let lastPayload = null;
  let lastStatus = null;
  let lastUpdate = null;
  let connected = false;
  let stopped = false;
  let editSession = null;
  let editorColumns = {};
  let saveState = 'idle';
  let saveError = null;
  let serverSimulated = false;

  function applySimState(simulated) {
    serverSimulated = simulated === true;
    onSimModeChange?.(serverSimulated);
    if (lastPayload) {
      lastPayload = { ...lastPayload, simulated: serverSimulated };
    }
    setConnectionState(connected, lastUpdate, lastPayload, serverSimulated);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === 'init') {
      viewConfig = {
        title: msg.title,
        fields: msg.fields ?? [],
        system: msg.system === true,
        viewId,
      };
      editorColumns = msg.editorColumns ?? {};
      viewsList = msg.views ?? null;
      mountViewNav(viewId, viewsList, { settingsActive });
      if (msg.status) lastStatus = msg.status;
      applySimState(msg.simulated === true);
      if (msg.payload) {
        lastPayload = msg.payload;
        lastUpdate = new Date();
        onPayload?.(lastPayload);
      }
      render();
      return;
    }

    if (msg.type === 'simState') {
      applySimState(msg.simulated === true);
      render();
      return;
    }

    if (msg.type === 'status' && msg.status) {
      lastStatus = msg.status;
      if (editSession && viewConfig?.system && root) {
        updateAdminLiveChrome(root, {
          payload: lastPayload,
          status: lastStatus,
          connected,
          lastUpdate,
          editSession,
        });
        return;
      }
      render();
      return;
    }

    if (msg.type === 'cue' && msg.payload) {
      lastPayload = msg.payload;
      lastUpdate = new Date();
      applySimState(msg.payload.simulated === true);
      onPayload?.(lastPayload);
      if (editSession && viewConfig?.system && root) {
        updateAdminLiveChrome(root, {
          payload: lastPayload,
          status: lastStatus,
          connected,
          lastUpdate,
          editSession,
        });
        return;
      }
      render();
    }
  }

  function startEdit() {
    if (!lastPayload?.match?.matched || !lastPayload.row) return;
    editSession = captureEditSession(lastPayload);
    saveState = 'idle';
    saveError = null;
    render();
  }

  function cancelEdit() {
    editSession = null;
    saveState = 'idle';
    saveError = null;
    render();
  }

  async function saveEdit(formSection) {
    if (!editSession || saveState === 'saving') return;

    const form = formSection.querySelector('.row-editor');
    if (!form) return;

    const changes = collectEditorChanges(form, editSession.row);
    if (Object.keys(changes).length === 0) {
      cancelEdit();
      return;
    }

    saveState = 'saving';
    saveError = null;
    render();

    try {
      const res = await fetch(`/api/sheets/rows/${encodeURIComponent(editSession.rowId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      editSession = null;
      saveState = 'idle';
      saveError = null;
      render();
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Save failed';
      render();
    }
  }

  function render() {
    if (!viewConfig) return;
    const ctx = {
      ...viewConfig,
      payload: lastPayload,
      status: lastStatus,
      connected,
      lastUpdate,
    };
    if (statusOnly) {
      setConnectionState(connected, lastUpdate, lastPayload, serverSimulated);
      return;
    }
    if (viewConfig.system) {
      renderAdmin(root, {
        ...ctx,
        editSession,
        editorColumns,
        saveState,
        saveError,
        onStartEdit: startEdit,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
    } else {
      renderView(root, ctx);
    }
  }

  function setConnected(next) {
    connected = next;
    setConnectionState(connected, lastUpdate, lastPayload, serverSimulated);
  }

  function connect() {
    if (stopped) return;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?view=${encodeURIComponent(viewId)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => setConnected(true));
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => {
      setConnected(false);
      ws = null;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      ws?.close();
    });
  }

  connect();

  return {
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
