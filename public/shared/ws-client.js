// Shared WebSocket client (NFR-6). Auto-reconnect + connection/last-update display.

import {
  renderView,
  renderAdmin,
  updateAdminLiveChrome,
  updateViewLiveChrome,
  captureEditSession,
  setConnectionState,
} from './view-render.js';
import { renderSession } from './session-render.js';
import {
  collectEditorChanges,
  collectEditorValues,
  captureCreateSession,
  viewFieldColumns,
} from './admin-row-editor.js';
import { mountViewNav } from './view-nav.js';

const RECONNECT_MS = 1500;

function tracksKey(tracks) {
  return JSON.stringify(tracks ?? []);
}

function cueContentChanged(prev, next) {
  if (!prev) return true;
  return prev.clipName !== next.clipName
    || prev.match?.rowId !== next.match?.rowId
    || prev.match?.matched !== next.match?.matched
    || prev.tempo !== next.tempo
    || prev.beat !== next.beat
    || prev.pendingLaunch !== next.pendingLaunch
    || tracksKey(prev.tracks) !== tracksKey(next.tracks);
}

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
  let sheetHeaders = [];
  let matchColumn = null;
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

  function updateLiveChromeDuringEdit() {
    if (!editSession || !root) return;
    const chrome = {
      payload: lastPayload,
      connected,
      lastUpdate,
      editSession,
    };
    if (viewConfig.system) {
      updateAdminLiveChrome(root, { ...chrome, status: lastStatus });
    } else {
      updateViewLiveChrome(root, chrome);
    }
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
        editable: msg.system !== true && msg.editable !== false,
        viewId,
      };
      editorColumns = msg.editorColumns ?? {};
      sheetHeaders = msg.sheetHeaders ?? [];
      matchColumn = msg.matchColumn ?? null;
      viewsList = msg.views ?? null;
      mountViewNav(viewId, viewsList, { settingsActive });
      const isSession = viewId === 'session';
      document.body.classList.toggle(
        'layout-operator',
        !viewConfig.system && !statusOnly && !isSession,
      );
      document.body.classList.toggle('layout-session', isSession);
      if (msg.status) lastStatus = msg.status;
      applySimState(msg.simulated === true);
      if (msg.payload) {
        lastPayload = msg.payload;
        if (cueContentChanged(null, msg.payload)) lastUpdate = new Date();
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
      if (editSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      render();
      return;
    }

    if (msg.type === 'cue' && msg.payload) {
      const prevPayload = lastPayload;
      lastPayload = msg.payload;
      if (cueContentChanged(prevPayload, msg.payload)) lastUpdate = new Date();
      applySimState(msg.payload.simulated === true);
      onPayload?.(lastPayload);
      if (editSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      render();
    }
  }

  function startEdit() {
    if (!lastPayload?.match?.matched || !lastPayload.row) return;
    const scope = viewConfig.editable
      ? { columns: viewFieldColumns(viewConfig.fields) }
      : undefined;
    editSession = captureEditSession(lastPayload, scope);
    saveState = 'idle';
    saveError = null;
    render();
  }

  function startCreate() {
    const clipName = lastPayload?.clipName?.trim();
    if (!clipName || lastPayload?.match?.matched === true) return;
    if (!matchColumn) return;

    const columns = viewConfig.system
      ? sheetHeaders.filter(Boolean)
      : viewFieldColumns(viewConfig.fields);
    if (!viewConfig.system && !columns.length) return;
    if (viewConfig.system && !columns.length) return;

    editSession = captureCreateSession({
      clipName,
      headers: sheetHeaders,
      matchColumn,
      columns: viewConfig.system ? undefined : columns,
    });
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

    const form = formSection.querySelector('.row-editor, .fields--edit');
    if (!form) return;

    const isCreate = editSession.mode === 'create';
    let payloadBody = isCreate
      ? collectEditorValues(form)
      : collectEditorChanges(form, editSession.row);

    if (isCreate && matchColumn && !(matchColumn in payloadBody)) {
      payloadBody[matchColumn] = editSession.clipNameAtEdit?.trim() ?? '';
    }

    if (!isCreate && Object.keys(payloadBody).length === 0) {
      cancelEdit();
      return;
    }

    saveState = 'saving';
    saveError = null;
    render();

    try {
      const url = isCreate
        ? '/api/sheets/rows'
        : `/api/sheets/rows/${encodeURIComponent(editSession.rowId)}`;
      const res = await fetch(url, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadBody),
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
    if (viewId === 'session') {
      renderSession(root, ctx);
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
        onStartCreate: startCreate,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
    } else {
      renderView(root, {
        ...ctx,
        editable: viewConfig.editable,
        editSession,
        editorColumns,
        saveState,
        saveError,
        onStartEdit: viewConfig.editable ? startEdit : undefined,
        onStartCreate: viewConfig.editable ? startCreate : undefined,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
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
