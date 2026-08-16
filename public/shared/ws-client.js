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
import { captureAliasPanelFocus, createAliasSession } from './alias-panel.js';
import { playingTracks, operatorCreateColumns } from './playing-clips-strip.js';
import { mountViewNav, viewIdFromPath } from './view-nav.js';
import { isKioskMode, kioskLinkAction, mountKioskControls } from './kiosk-controls.js';

const RECONNECT_MS = 1500;
const ALIAS_SEARCH_DEBOUNCE_MS = 180;

function tracksKey(tracks) {
  return JSON.stringify(tracks ?? []);
}

function sceneKey(scene) {
  return JSON.stringify(scene ?? null);
}

function cueContentChanged(prev, next) {
  if (!prev) return true;
  return prev.clipName !== next.clipName
    || prev.match?.rowId !== next.match?.rowId
    || prev.match?.matched !== next.match?.matched
    || prev.tempo !== next.tempo
    || prev.beat !== next.beat
    || prev.isPlaying !== next.isPlaying
    || prev.pendingLaunch !== next.pendingLaunch
    || tracksKey(prev.tracks) !== tracksKey(next.tracks)
    || sceneKey(prev.scene) !== sceneKey(next.scene);
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
  mountKioskControls();

  let currentViewId = viewId;
  let socketGen = 0;
  let ws = null;
  let reconnectTimer = null;
  let viewConfig = null;
  let viewsList = null;
  let lastPayload = null;
  let lastStatus = null;
  let lastSessionLog = null;
  let lastUpdate = null;
  let connected = false;
  let stopped = false;
  let editSession = null;
  let aliasSession = null;
  let editorColumns = {};
  let sheetHeaders = [];
  let matchColumn = null;
  let aliasColumn = null;
  let saveState = 'idle';
  let saveError = null;
  let serverSimulated = false;
  let aliasSearchTimer = null;
  let aliasSearchSeq = 0;
  let aliasAutoFocusSearch = false;

  function applySimState(simulated) {
    serverSimulated = simulated === true;
    onSimModeChange?.(serverSimulated);
    if (lastPayload) {
      lastPayload = { ...lastPayload, simulated: serverSimulated };
    }
    setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
  }

  function applySessionLogState(sessionLog) {
    lastSessionLog = sessionLog ?? null;
    setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function updateLiveChromeDuringEdit() {
    if ((!editSession && !aliasSession) || !root) return;
    const chrome = {
      payload: lastPayload,
      connected,
      lastUpdate,
      editSession,
    };
    if (viewConfig.system) {
      updateAdminLiveChrome(root, { ...chrome, status: lastStatus, matchColumn });
    } else {
      updateViewLiveChrome(root, { ...chrome, matchColumn });
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
        viewId: currentViewId,
      };
      editorColumns = msg.editorColumns ?? {};
      sheetHeaders = msg.sheetHeaders ?? [];
      matchColumn = msg.matchColumn ?? null;
      aliasColumn = msg.aliasColumn ?? null;
      viewsList = msg.views ?? null;
      mountViewNav(currentViewId, viewsList, { settingsActive, onNavigate });
      const isSession = currentViewId === 'session';
      document.body.classList.toggle(
        'layout-operator',
        !viewConfig.system && !statusOnly && !isSession,
      );
      document.body.classList.toggle('layout-session', isSession);
      document.title = `AbleView — ${viewConfig.title ?? currentViewId}`;
      root?.classList.toggle('admin-main', viewConfig.system === true && currentViewId === 'admin');
      if (msg.status) lastStatus = msg.status;
      if (msg.sessionLog) applySessionLogState(msg.sessionLog);
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

    if (msg.type === 'sessionLog' && msg.sessionLog) {
      applySessionLogState(msg.sessionLog);
      if (editSession || aliasSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      render();
      return;
    }

    if (msg.type === 'status' && msg.status) {
      lastStatus = msg.status;
      if (editSession || aliasSession) {
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
      if (editSession || aliasSession) {
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

  function startCreate(clipNameOverride, track = null) {
    const clipName = (clipNameOverride ?? lastPayload?.clipName)?.trim()
      || playingTracks(lastPayload)[0]?.clipName?.trim();
    if (!clipName || lastPayload?.match?.matched === true) return;
    if (!matchColumn) return;
    if (aliasSession) cancelAlias();

    const isSystem = viewConfig.system;
    const columns = isSystem
      ? sheetHeaders.filter(Boolean)
      : operatorCreateColumns(viewConfig.fields, matchColumn, aliasColumn);
    if (!columns.length) return;

    editSession = captureCreateSession({
      clipName,
      headers: sheetHeaders,
      matchColumn,
      aliasColumn,
      columns: isSystem ? undefined : columns,
      trackName: track?.trackName ?? null,
      trackIndex: track?.trackIndex ?? null,
    });
    saveState = 'idle';
    saveError = null;
    render();
  }

  function startAlias(clipNameOverride, track = null) {
    const clipName = (clipNameOverride ?? lastPayload?.clipName)?.trim();
    if (!clipName) return;
    if (!clipNameOverride && lastPayload?.match?.matched === true) return;
    if (editSession) cancelEdit();

    aliasSession = createAliasSession(clipName, {
      trackName: track?.trackName ?? null,
      trackIndex: track?.trackIndex ?? null,
    });
    aliasAutoFocusSearch = true;
    saveState = 'idle';
    saveError = null;
    render();
    runAliasSearch(aliasSession.query);
  }

  function cancelEdit() {
    editSession = null;
    saveState = 'idle';
    saveError = null;
    render();
  }

  function cancelAlias() {
    if (aliasSearchTimer) {
      clearTimeout(aliasSearchTimer);
      aliasSearchTimer = null;
    }
    aliasSession = null;
    saveState = 'idle';
    saveError = null;
    render();
  }

  function scheduleAliasSearch(query) {
    if (!aliasSession) return;
    aliasSession = { ...aliasSession, query, searching: true };
    render();
    if (aliasSearchTimer) clearTimeout(aliasSearchTimer);
    aliasSearchTimer = setTimeout(() => {
      aliasSearchTimer = null;
      runAliasSearch(query);
    }, ALIAS_SEARCH_DEBOUNCE_MS);
  }

  async function runAliasSearch(query) {
    if (!aliasSession) return;
    const seq = ++aliasSearchSeq;
    aliasSession = { ...aliasSession, query, searching: true };
    render();

    try {
      const url = `/api/sheets/rows/search?q=${encodeURIComponent(query ?? '')}&limit=15`;
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (seq !== aliasSearchSeq || !aliasSession) return;
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);

      aliasSession = {
        ...aliasSession,
        results: body.results ?? [],
        aliasColumnPresent: body.aliasColumnPresent ?? null,
        aliasColumn: body.aliasColumn ?? aliasSession.aliasColumn,
        searching: false,
      };
      saveError = null;
      render();
    } catch (err) {
      if (seq !== aliasSearchSeq || !aliasSession) return;
      aliasSession = { ...aliasSession, results: [], searching: false };
      saveError = err.message ?? 'Search failed';
      render();
    }
  }

  function selectAliasRow(row) {
    if (!aliasSession) return;
    aliasSession = { ...aliasSession, selectedRow: row };
    saveError = null;
    render();
  }

  function changeAliasText(aliasText) {
    if (!aliasSession) return;
    aliasSession = { ...aliasSession, aliasText };
    saveError = null;
    render();
  }

  async function saveAlias() {
    if (!aliasSession || saveState === 'saving') return;
    const rowId = aliasSession.selectedRow?.rowId;
    const alias = String(aliasSession.aliasText ?? '').trim();
    if (!rowId || !alias) return;

    saveState = 'saving';
    saveError = null;
    render();

    try {
      const res = await fetch(`/api/sheets/rows/${encodeURIComponent(rowId)}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      aliasSession = null;
      saveState = 'idle';
      saveError = null;
      render();
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Save failed';
      render();
    }
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

  function buildAliasPanelProps() {
    if (!aliasSession) return null;
    return {
      clipName: aliasSession.clipName,
      trackLabel: aliasSession.trackLabel ?? null,
      aliasText: aliasSession.aliasText,
      query: aliasSession.query,
      results: aliasSession.results,
      selectedRow: aliasSession.selectedRow,
      aliasColumnPresent: aliasSession.aliasColumnPresent,
      aliasColumn: aliasSession.aliasColumn,
      searching: aliasSession.searching,
      saveState,
      saveError,
      onQueryChange: scheduleAliasSearch,
      onSelectRow: selectAliasRow,
      onAliasChange: changeAliasText,
      onCancel: cancelAlias,
      onSave: saveAlias,
    };
  }

  function render() {
    if (!viewConfig) return;
    const ctx = {
      ...viewConfig,
      payload: lastPayload,
      status: lastStatus,
      connected,
      lastUpdate,
      matchColumn,
      aliasColumn,
    };
    if (statusOnly) {
      setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
      return;
    }
    const aliasFocus = aliasSession ? captureAliasPanelFocus() : null;
    const autoFocusSearch = aliasAutoFocusSearch;
    aliasAutoFocusSearch = false;

    const aliasPanel = buildAliasPanelProps();
    if (aliasPanel) {
      aliasPanel.focusRestore = aliasFocus;
      aliasPanel.autoFocusSearch = autoFocusSearch;
    }
    if (currentViewId === 'session') {
      renderSession(root, {
        ...ctx,
        editSession,
        aliasSession,
        aliasPanel,
        editorColumns,
        saveState,
        saveError,
        onStartAlias: startAlias,
        onStartCreate: startCreate,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
      return;
    }
    if (viewConfig.system) {
      renderAdmin(root, {
        ...ctx,
        editSession,
        aliasSession,
        aliasPanel,
        editorColumns,
        saveState,
        saveError,
        onStartEdit: startEdit,
        onStartCreate: startCreate,
        onStartAlias: startAlias,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
    } else {
      renderView(root, {
        ...ctx,
        editable: viewConfig.editable,
        editSession,
        aliasSession,
        aliasPanel,
        editorColumns,
        saveState,
        saveError,
        onStartEdit: viewConfig.editable ? startEdit : undefined,
        onStartCreate: viewConfig.editable ? startCreate : undefined,
        onStartAlias: viewConfig.editable ? startAlias : undefined,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
      });
    }
  }

  function setConnected(next) {
    connected = next;
    setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
  }

  function connect() {
    if (stopped) return;
    const gen = socketGen;

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws?view=${encodeURIComponent(currentViewId)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      if (gen !== socketGen) return;
      setConnected(true);
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => {
      if (gen !== socketGen) return;
      setConnected(false);
      ws = null;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      if (gen !== socketGen) return;
      ws?.close();
    });
  }

  function reconnectNow() {
    socketGen += 1;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const previous = ws;
    ws = null;
    previous?.close();
    connect();
  }

  function shouldInterceptNav(nextId) {
    if (statusOnly) return false;
    if (!nextId || nextId === 'settings') return false;
    return isKioskMode() || Boolean(document.fullscreenElement);
  }

  function switchToView(nextId, href, { historyMode = 'push' } = {}) {
    if (!nextId || nextId === currentViewId) return;
    currentViewId = nextId;
    editSession = null;
    aliasSession = null;
    saveState = 'idle';
    saveError = null;
    if (href && historyMode !== 'none') {
      const url = new URL(href, location.href);
      const next = `${url.pathname}${url.search}`;
      if (historyMode === 'replace') history.replaceState({ viewId: nextId }, '', next);
      else history.pushState({ viewId: nextId }, '', next);
    }
    reconnectNow();
  }

  function onNavigate(nextId, href) {
    const action = kioskLinkAction(nextId, {
      kiosk: isKioskMode(),
      statusOnly,
      fullscreen: Boolean(document.fullscreenElement),
    });
    if (action === 'follow') return true;
    if (action === 'replace') {
      if (href) location.replace(href);
      return false;
    }
    switchToView(nextId, href, { historyMode: action === 'spa-replace' ? 'replace' : 'push' });
    return false;
  }

  function onPopState() {
    const nextId = viewIdFromPath(location.pathname);
    if (!nextId || nextId === 'settings' || nextId === currentViewId) return;
    if (!shouldInterceptNav(nextId)) return;
    switchToView(nextId, null, { historyMode: 'none' });
  }

  window.addEventListener('popstate', onPopState);

  connect();

  return {
    stop() {
      stopped = true;
      socketGen += 1;
      window.removeEventListener('popstate', onPopState);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
