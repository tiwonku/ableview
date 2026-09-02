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
  renderSetlist,
  captureSetlistFocus,
} from './setlist-render.js';
import {
  collectEditorChanges,
  collectEditorValues,
  captureCreateSession,
  viewFieldColumns,
  openOperatorColorField,
} from './admin-row-editor.js';
import { captureAliasPanelFocus, createAliasSession } from './alias-panel.js';
import { createPinSession, mergePinResults } from './pin-panel.js';
import { closeColorPicker } from './color-picker.js';
import {
  operatorCreateColumns,
  resolveCreateClipName,
  canStartCreate,
} from './playing-clips-strip.js';
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

function setlistCueChanged(prev, next) {
  if (!prev) return true;
  return prev.clipName !== next.clipName
    || prev.match?.rowId !== next.match?.rowId
    || prev.match?.matched !== next.match?.matched
    || prev.match?.viaOverride !== next.match?.viaOverride;
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

  let currentViewId = viewId;
  let showingSettings = settingsActive === true;
  let settingsGen = 0;
  let unmountSettings = null;
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
  let cuePane = 'last';
  let pinSession = null;
  let lastSetlist = null;
  let setlistAddQuery = '';
  let setlistAddResults = [];
  let setlistAddSearching = false;
  let setlistNameDraft = '';
  let setlistAutoFocusSearch = false;
  let sessionLogGen = 0;
  let unmountSessionLog = null;

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
    if ((!editSession && !aliasSession && !pinSession) || !root) return;
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
      syncChrome();
      if (msg.status) lastStatus = msg.status;
      if (msg.sessionLog) applySessionLogState(msg.sessionLog);
      if (msg.setlist) {
        lastSetlist = msg.setlist;
        if (!setlistNameDraft) setlistNameDraft = msg.setlist.name ?? '';
      }
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
      if (editSession || aliasSession || pinSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      render();
      return;
    }

    if (msg.type === 'setlist' && msg.setlist) {
      lastSetlist = msg.setlist;
      if (pinSession && !String(pinSession.query ?? '').trim()) {
        applyPinResults(pinSession.query ?? '');
        render();
        return;
      }
      if (currentViewId === 'setlist' && !showingSettings && !statusOnly) render();
      return;
    }

    if (msg.type === 'status' && msg.status) {
      lastStatus = msg.status;
      if (editSession || aliasSession || pinSession) {
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
      if (prevPayload?.match?.matched !== true && msg.payload.match?.matched === true) {
        cuePane = 'last';
      }
      applySimState(msg.payload.simulated === true);
      onPayload?.(lastPayload);
      if (editSession || aliasSession || pinSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      if (currentViewId === 'setlist' && !setlistCueChanged(prevPayload, lastPayload)) {
        setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
        return;
      }
      render();
    }
  }

  function setCuePane(next) {
    cuePane = next === 'current' ? 'current' : 'last';
    render();
  }

  function startEdit(openColorColumn) {
    if (!lastPayload?.match?.matched || !lastPayload.row) return;
    if (pinSession) cancelPin();
    if (aliasSession) cancelAlias();
    const column = typeof openColorColumn === 'string' ? openColorColumn : null;
    const scope = viewConfig.editable
      ? { columns: viewFieldColumns(viewConfig.fields) }
      : undefined;
    editSession = captureEditSession(lastPayload, scope);
    saveState = 'idle';
    saveError = null;
    render();
    if (column) openOperatorColorField(root, column);
  }

  function startCreate(clipNameOverride, track = null) {
    const clipName = resolveCreateClipName(lastPayload, clipNameOverride);
    if (!canStartCreate(lastPayload, clipNameOverride)) return;
    if (!matchColumn) return;
    if (aliasSession) cancelAlias();
    if (pinSession) cancelPin();

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
    const clipName = typeof clipNameOverride === 'string'
      ? clipNameOverride.trim()
      : (lastPayload?.clipName?.trim() ?? '');
    if (!clipName) return;
    if (typeof clipNameOverride !== 'string' && lastPayload?.match?.matched === true) return;
    if (editSession) cancelEdit();
    if (pinSession) cancelPin();

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

  function cancelPin() {
    if (aliasSearchTimer) {
      clearTimeout(aliasSearchTimer);
      aliasSearchTimer = null;
    }
    pinSession = null;
    saveState = 'idle';
    saveError = null;
    render();
  }

  function applyPinResults(query, sheetResults = []) {
    if (!pinSession) return;
    const merged = mergePinResults({
      query,
      setlist: lastSetlist,
      sheetResults,
    });
    pinSession = {
      ...pinSession,
      query,
      results: merged.results,
      source: merged.source,
      searching: false,
    };
  }

  function startPin() {
    if (editSession) cancelEdit();
    if (aliasSession) cancelAlias();
    pinSession = createPinSession();
    aliasAutoFocusSearch = true;
    saveState = 'idle';
    saveError = null;
    applyPinResults('');
    render();
  }

  function pinLastCue() {
    const rowId = lastPayload?.lastMatched?.rowId;
    if (!rowId) return;
    postPin(rowId);
  }

  function selectPinRow(row) {
    if (!pinSession) return;
    pinSession = { ...pinSession, selectedRow: row };
    saveError = null;
    render();
  }

  function schedulePinSearch(query) {
    if (!pinSession) return;
    if (aliasSearchTimer) {
      clearTimeout(aliasSearchTimer);
      aliasSearchTimer = null;
    }
    if (!String(query ?? '').trim()) {
      applyPinResults('');
      saveError = null;
      render();
      return;
    }
    const preview = mergePinResults({
      query,
      setlist: lastSetlist,
      sheetResults: [],
    });
    pinSession = {
      ...pinSession,
      query,
      results: preview.results,
      source: preview.source,
      searching: true,
    };
    render();
    aliasSearchTimer = setTimeout(() => {
      aliasSearchTimer = null;
      runPinSearch(query);
    }, ALIAS_SEARCH_DEBOUNCE_MS);
  }

  async function runPinSearch(query) {
    if (!pinSession) return;
    if (!String(query ?? '').trim()) {
      applyPinResults('');
      saveError = null;
      render();
      return;
    }
    const seq = ++aliasSearchSeq;
    pinSession = { ...pinSession, query, searching: true };
    render();

    try {
      const url = `/api/sheets/rows/search?q=${encodeURIComponent(query ?? '')}&limit=15`;
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (seq !== aliasSearchSeq || !pinSession) return;
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);

      applyPinResults(query, body.results ?? []);
      saveError = null;
      render();
    } catch (err) {
      if (seq !== aliasSearchSeq || !pinSession) return;
      const preview = mergePinResults({
        query,
        setlist: lastSetlist,
        sheetResults: [],
      });
      pinSession = {
        ...pinSession,
        query,
        results: preview.results,
        source: preview.source,
        searching: false,
      };
      saveError = err.message ?? 'Search failed';
      render();
    }
  }

  async function savePin() {
    const rowId = pinSession?.selectedRow?.rowId;
    if (!rowId) return;
    await postPin(rowId);
  }

  async function postPin(rowId) {
    if (saveState === 'saving') return;
    saveState = 'saving';
    saveError = null;
    render();
    try {
      const res = await fetch('/api/match/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId: String(rowId) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Pin failed (${res.status})`);
      pinSession = null;
      saveState = 'idle';
      saveError = null;
      render();
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Pin failed';
      render();
    }
  }

  function applySetlistState(body) {
    if (!body || body.ok === false) return;
    const { ok: _ok, error: _error, ...state } = body;
    if (state.name && state.name !== lastSetlist?.name) {
      setlistNameDraft = state.name;
    }
    if (state.items || state.name) lastSetlist = state;
  }

  async function mutateSetlist(url, { method = 'POST', body } = {}) {
    if (saveState === 'saving') return;
    saveState = 'saving';
    saveError = null;
    render();
    try {
      const res = await fetch(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload.error && payload.error !== 'Not Found'
          ? payload.error
          : payload.message ?? payload.error ?? `Setlist failed (${res.status})`;
        throw new Error(detail);
      }
      applySetlistState(payload);
      saveState = 'idle';
      saveError = null;
      render();
      return payload;
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Setlist failed';
      render();
    }
  }

  function scheduleSetlistSearch(query) {
    setlistAddQuery = query;
    setlistAddSearching = true;
    render();
    if (aliasSearchTimer) clearTimeout(aliasSearchTimer);
    aliasSearchTimer = setTimeout(() => {
      aliasSearchTimer = null;
      runSetlistSearch(query);
    }, ALIAS_SEARCH_DEBOUNCE_MS);
  }

  async function runSetlistSearch(query) {
    const seq = ++aliasSearchSeq;
    setlistAddQuery = query;
    setlistAddSearching = true;
    render();
    try {
      const url = `/api/sheets/rows/search?q=${encodeURIComponent(query ?? '')}&limit=15`;
      const res = await fetch(url);
      const body = await res.json().catch(() => ({}));
      if (seq !== aliasSearchSeq) return;
      if (!res.ok) throw new Error(body.error ?? `Search failed (${res.status})`);
      setlistAddResults = body.results ?? [];
      setlistAddSearching = false;
      saveError = null;
      render();
    } catch (err) {
      if (seq !== aliasSearchSeq) return;
      setlistAddResults = [];
      setlistAddSearching = false;
      saveError = err.message ?? 'Search failed';
      render();
    }
  }

  async function addSetlistRow(row) {
    const result = await mutateSetlist('/api/setlist/items', {
      body: { rowId: row.rowId },
    });
    if (result?.ok) {
      setlistAddQuery = '';
      setlistAddResults = [];
      render();
    }
  }

  function moveSetlistItem(rowId, direction) {
    const items = lastSetlist?.items ?? [];
    const ids = items.map((item) => String(item.rowId));
    const from = ids.indexOf(String(rowId));
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, String(rowId));
    mutateSetlist('/api/setlist', { method: 'PATCH', body: { order: ids } });
  }

  async function clearPin() {
    if (saveState === 'saving') return;
    saveState = 'saving';
    saveError = null;
    render();
    try {
      const res = await fetch('/api/match/override', { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Clear pin failed (${res.status})`);
      saveState = 'idle';
      saveError = null;
      render();
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Clear pin failed';
      render();
    }
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

  function buildPinPanelProps() {
    if (!pinSession) return null;
    return {
      query: pinSession.query,
      results: pinSession.results,
      selectedRow: pinSession.selectedRow,
      searching: pinSession.searching,
      source: pinSession.source ?? 'setlist',
      setlistName: lastSetlist?.name ?? '',
      saveState,
      saveError,
      onQueryChange: schedulePinSearch,
      onSelectRow: selectPinRow,
      onCancel: cancelPin,
      onSave: savePin,
    };
  }

  function render() {
    closeColorPicker();
    if (!viewConfig) return;
    const ctx = {
      ...viewConfig,
      payload: lastPayload,
      status: lastStatus,
      connected,
      lastUpdate,
      matchColumn,
      aliasColumn,
      sessionLog: lastSessionLog,
      simulated: serverSimulated,
    };
    if (statusOnly || showingSettings) {
      setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
      return;
    }
    const aliasFocus = (aliasSession || pinSession) ? captureAliasPanelFocus() : null;
    const setlistFocus = currentViewId === 'setlist' ? captureSetlistFocus() : null;
    const autoFocusSearch = aliasAutoFocusSearch;
    aliasAutoFocusSearch = false;
    const autoFocusSetlistSearch = setlistAutoFocusSearch;
    setlistAutoFocusSearch = false;

    const aliasPanel = buildAliasPanelProps();
    if (aliasPanel) {
      aliasPanel.focusRestore = aliasFocus;
      aliasPanel.autoFocusSearch = autoFocusSearch;
    }
    const pinPanel = buildPinPanelProps();
    if (pinPanel) {
      pinPanel.focusRestore = aliasFocus;
      pinPanel.autoFocusSearch = autoFocusSearch;
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
    if (currentViewId === 'setlist') {
      renderSetlist(root, {
        ...ctx,
        setlist: lastSetlist,
        addQuery: setlistAddQuery,
        addResults: setlistAddResults,
        addSearching: setlistAddSearching,
        nameDraft: setlistNameDraft,
        saveState,
        saveError,
        focusRestore: setlistFocus,
        autoFocusSearch: autoFocusSetlistSearch,
        onAddQueryChange: scheduleSetlistSearch,
        onAddRow: addSetlistRow,
        onRemove: (rowId) => mutateSetlist(`/api/setlist/items/${encodeURIComponent(rowId)}`, { method: 'DELETE' }),
        onStatus: (rowId, status) => mutateSetlist(
          `/api/setlist/items/${encodeURIComponent(rowId)}`,
          { method: 'PATCH', body: { status } },
        ),
        onMove: moveSetlistItem,
        onReorder: (rowIds) => mutateSetlist('/api/setlist', { method: 'PATCH', body: { order: rowIds } }),
        onSwitch: (name) => mutateSetlist('/api/setlist', { method: 'PATCH', body: { name } }),
        onCreate: (name) => mutateSetlist('/api/setlist', { method: 'PATCH', body: { name, create: true } }),
        onDuplicate: (name) => mutateSetlist('/api/setlist', { method: 'PATCH', body: { name, duplicate: true } }),
        onDelete: () => mutateSetlist('/api/setlist', { method: 'PATCH', body: { delete: true } }),
        onNameDraftChange: (name) => {
          setlistNameDraft = name;
          render();
        },
        onPin: postPin,
        onClearPin: clearPin,
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
        pinSession,
        pinPanel,
        onStartPin: startPin,
        onPinLast: pinLastCue,
        onClearPin: clearPin,
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
        cuePane,
        onCuePaneChange: setCuePane,
        pinSession,
        pinPanel,
        onStartPin: startPin,
        onPinLast: pinLastCue,
        onClearPin: clearPin,
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

  function syncChrome() {
    const isSession = !showingSettings && currentViewId === 'session';
    const isSetlist = !showingSettings && currentViewId === 'setlist';
    const isAdmin = !showingSettings && viewConfig?.system === true && currentViewId === 'admin';
    const isOperator = Boolean(viewConfig)
      && !viewConfig.system
      && !statusOnly
      && !isSession
      && !isSetlist
      && !showingSettings;
    document.body.classList.toggle('layout-operator', isOperator);
    document.body.classList.toggle('layout-session', isSession);
    document.body.classList.toggle('layout-setlist', isSetlist);
    document.body.classList.toggle('layout-settings', showingSettings);
    document.title = showingSettings
      ? 'AbleView — Settings'
      : `AbleView — ${viewConfig?.title ?? currentViewId}`;
    root?.classList.toggle('admin-main', isAdmin);
    root?.classList.toggle('settings-main', showingSettings);
    if (showingSettings) root?.setAttribute('aria-label', 'Settings');
    else root?.removeAttribute('aria-label');
    const simHost = document.getElementById('sim-controls-host');
    if (simHost) simHost.hidden = showingSettings;
    if (viewsList) {
      mountViewNav(currentViewId, viewsList, { settingsActive: showingSettings, onNavigate });
    }
    syncSessionLogPanel();
  }

  async function syncSessionLogPanel() {
    const onSet = !statusOnly && !showingSettings && currentViewId === 'setlist';
    if (!onSet) {
      sessionLogGen += 1;
      unmountSessionLog?.();
      unmountSessionLog = null;
      const host = document.getElementById('session-log');
      if (host) {
        host.replaceChildren();
        host.hidden = true;
      }
      return;
    }
    if (unmountSessionLog) {
      const host = document.getElementById('session-log');
      if (host) host.hidden = false;
      return;
    }
    const gen = ++sessionLogGen;
    const { ensureSessionLogHost, mountSessionLogPanel } = await import('./admin-session-log.js');
    if (gen !== sessionLogGen || showingSettings || currentViewId !== 'setlist') return;
    const { host } = ensureSessionLogHost(root);
    if (!host) return;
    host.hidden = false;
    unmountSessionLog?.();
    unmountSessionLog = mountSessionLogPanel(host);
  }

  function applyHistory(nextId, href, historyMode) {
    if (!href || historyMode === 'none') return;
    const url = new URL(href, location.href);
    const next = `${url.pathname}${url.search}`;
    if (historyMode === 'replace') history.replaceState({ viewId: nextId }, '', next);
    else history.pushState({ viewId: nextId }, '', next);
  }

  function leaveSettings() {
    settingsGen += 1;
    showingSettings = false;
    unmountSettings?.();
    unmountSettings = null;
    document.body.classList.remove('layout-settings');
    root?.classList.remove('settings-main');
    root?.removeAttribute('aria-label');
  }

  async function enterSettings(href, historyMode) {
    if (showingSettings && unmountSettings) return;
    showingSettings = true;
    closeColorPicker();
    editSession = null;
    aliasSession = null;
    pinSession = null;
    saveState = 'idle';
    saveError = null;
    applyHistory('settings', href, historyMode);
    syncChrome();
    const gen = ++settingsGen;
    const { attachSettingsOverlay } = await import('./settings-overlay.js');
    if (gen !== settingsGen || !showingSettings) return;
    unmountSettings?.();
    unmountSettings = attachSettingsOverlay(root);
  }

  function shouldInterceptNav(nextId) {
    if (statusOnly) return false;
    if (!nextId) return false;
    return isKioskMode() || Boolean(document.fullscreenElement);
  }

  function switchToView(nextId, href, { historyMode = 'push' } = {}) {
    if (!nextId) return;
    if (nextId === 'settings') {
      enterSettings(href, historyMode);
      return;
    }
    if (showingSettings) leaveSettings();
    if (nextId === currentViewId) {
      syncChrome();
      render();
      return;
    }
    currentViewId = nextId;
    editSession = null;
    aliasSession = null;
    pinSession = null;
    saveState = 'idle';
    saveError = null;
    cuePane = 'last';
    setlistAddQuery = '';
    setlistAddResults = [];
    setlistAddSearching = false;
    applyHistory(nextId, href, historyMode);
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
    if (!nextId) return;
    if (nextId === 'settings') {
      if (!shouldInterceptNav(nextId)) return;
      enterSettings(null, 'none');
      return;
    }
    if (nextId === currentViewId && !showingSettings) return;
    if (!shouldInterceptNav(nextId)) return;
    switchToView(nextId, null, { historyMode: 'none' });
  }

  window.addEventListener('popstate', onPopState);

  mountKioskControls();

  if (showingSettings && !statusOnly) {
    enterSettings(null, 'none');
  }

  connect();

  return {
    stop() {
      stopped = true;
      socketGen += 1;
      sessionLogGen += 1;
      unmountSessionLog?.();
      unmountSessionLog = null;
      leaveSettings();
      window.removeEventListener('popstate', onPopState);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
