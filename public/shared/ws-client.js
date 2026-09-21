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
  renderSetNav,
  captureSetlistFocus,
  updateSetlistLiveChrome,
  resetSetNavScroll,
  buildQuickCueChanges,
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
  resolveMatchedTitle,
  readStoredCuePane,
  resolveStoredCuePane,
  writeStoredCuePane,
} from './playing-clips-strip.js';
import { mountViewNav, viewIdFromPath } from './view-nav.js';
import { isKioskMode, kioskLinkAction, mountKioskControls } from './kiosk-controls.js';
import {
  parkSessionLogForRender,
  placeSessionLogMount,
  restoreMountedFieldFocus,
} from './admin-session-log.js';
import {
  flattenOperatorFields,
  isWideAdminViewport,
  parseAdminBoardMode,
  readStoredAdminBoardMode,
  readStoredAdminSetDrawer,
  resolveAdminBoardMode,
  resolveAdminSetDrawer,
  writeStoredAdminBoardMode,
  writeStoredAdminSetDrawer,
} from './admin-dashboard.js';
import { applyLiveColorOverlay, DEFAULT_LIVE_COLOR_COLUMNS } from './live-color-overlay.js';
import {
  buildFlashLookSlots,
  canFlashLook,
  flashLookDisabledReason,
  flashableColorColumns,
  isLiveColorMoving,
} from './flash-look.js';
import {
  abortFlashLookIfRowChanged,
  closeFlashLook,
  openFlashLook,
  syncFlashLookButton,
} from './flash-look-overlay.js';
import { mountBreathPage, mountBreathPreview } from './breath-render.js';

const RECONNECT_MS = 1500;
const ALIAS_SEARCH_DEBOUNCE_MS = 180;

function tracksKey(tracks) {
  return JSON.stringify((tracks ?? []).map((t) => [
    t.trackIndex,
    t.clipName ?? null,
    t.slotIndex ?? null,
    t.trackName ?? null,
  ]));
}

function sceneKey(scene) {
  if (!scene) return '';
  return `${scene.index ?? ''}\0${scene.name ?? ''}\0${scene.pending ? 1 : 0}\0${scene.launchType ?? ''}`;
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

function dashboardCueChanged(prev, next) {
  if (!prev) return true;
  return prev.clipName !== next.clipName
    || prev.match?.rowId !== next.match?.rowId
    || prev.match?.matched !== next.match?.matched
    || prev.match?.viaOverride !== next.match?.viaOverride
    || prev.pendingLaunch !== next.pendingLaunch
    || tracksKey(prev.tracks) !== tracksKey(next.tracks)
    || sceneKey(prev.scene) !== sceneKey(next.scene)
    || prev.stale !== next.stale;
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
  let settingsOverlay = null;
  let breathCtl = null;
  let dashBreathCtl = null;
  let socketGen = 0;
  let ws = null;
  let reconnectTimer = null;
  let viewConfig = null;
  let viewsList = null;
  let lastPayload = null;
  let lastStatus = null;
  let lastLiveColors = null;
  let prevLiveColors = null;
  let liveColorColumns = { ...DEFAULT_LIVE_COLOR_COLUMNS };
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
  let cuePane = resolveStoredCuePane(readStoredCuePane());
  let pinSession = null;
  let lastSetlist = null;
  let setlistAddQuery = '';
  let setlistAddResults = [];
  let setlistAddSearching = false;
  let setlistAddOpen = null;
  let setlistCreateKey = '';
  let setlistNameDraft = '';
  let setlistAutoFocusSearch = false;
  let setlistSyncing = false;
  let sessionLogGen = 0;
  let unmountSessionLog = null;
  let sessionLogMountEl = null;
  let sessionLogFocusGen = 0;
  let operatorViews = [];
  let boardMode = resolveAdminBoardMode({
    search: typeof location !== 'undefined' ? location.search : '',
    stored: readStoredAdminBoardMode(),
    kiosk: isKioskMode(),
  });
  let setDrawerOpen = resolveAdminSetDrawer({
    stored: readStoredAdminSetDrawer(),
    kiosk: isKioskMode(),
    wide: isWideAdminViewport(typeof window !== 'undefined' ? window : null),
  }) === 'open';

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

  function setlistChromeCtx() {
    return {
      payload: lastPayload,
      setlist: lastSetlist,
      matchColumn,
      connected,
      lastUpdate,
      simulated: serverSimulated,
      sessionLog: lastSessionLog,
      status: lastStatus,
      syncing: setlistSyncing,
      editSession,
      onSyncSheet: syncSheet,
    };
  }

  function adminChromeOpts() {
    return {
      payload: lastPayload,
      connected,
      lastUpdate,
      status: lastStatus,
      matchColumn,
      editSession,
      noMatchHero: currentViewId === 'admin' && boardMode === 'dashboard',
      cuePane,
    };
  }

  function updateAdminChrome({ refreshClipHead = true } = {}) {
    if (!root || showingSettings || statusOnly) return;
    updateAdminLiveChrome(root, { ...adminChromeOpts(), refreshClipHead });
  }

  function updateLiveChromeDuringEdit() {
    if ((!editSession && !aliasSession && !pinSession) || !root) return;
    const chrome = {
      payload: lastPayload,
      connected,
      lastUpdate,
      editSession,
    };
    if (currentViewId === 'setlist') {
      updateSetlistLiveChrome(root, setlistChromeCtx());
      return;
    }
    if (viewConfig.system) {
      updateAdminChrome();
    } else {
      updateViewLiveChrome(root, { ...chrome, matchColumn, cuePane });
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
      if (Array.isArray(msg.operatorViews)) operatorViews = msg.operatorViews;
      syncChrome();
      if (msg.status) lastStatus = msg.status;
      if (msg.sessionLog) applySessionLogState(msg.sessionLog);
      if (msg.setlist) {
        lastSetlist = msg.setlist;
        if (!setlistNameDraft) setlistNameDraft = msg.setlist.name ?? '';
      }
      if (msg.liveColors) lastLiveColors = msg.liveColors;
      if (msg.liveColorColumns) liveColorColumns = msg.liveColorColumns;
      applySimState(msg.simulated === true);
      if (msg.payload) {
        lastPayload = msg.payload;
        if (cueContentChanged(null, msg.payload)) lastUpdate = new Date();
        onPayload?.(lastPayload);
      }
      render();
      return;
    }

    if (msg.type === 'liveColors') {
      if (msg.liveColors) {
        prevLiveColors = lastLiveColors;
        lastLiveColors = msg.liveColors;
      }
      if (msg.liveColorColumns) liveColorColumns = msg.liveColorColumns;
      if (lastStatus) lastStatus = { ...lastStatus, liveColors: lastLiveColors };
      if (showingSettings) settingsOverlay?.applyLiveColors?.(lastLiveColors);
      if (viewConfig?.system && currentViewId === 'admin' && !showingSettings && !editSession && !aliasSession && !pinSession) {
        updateAdminChrome({ refreshClipHead: false });
      }
      paintLiveColors();
      return;
    }

    if (msg.type === 'simState') {
      applySimState(msg.simulated === true);
      render();
      return;
    }

    if (msg.type === 'sessionLog' && msg.sessionLog) {
      applySessionLogState(msg.sessionLog);
      return;
    }

    if (msg.type === 'setlist' && msg.setlist) {
      lastSetlist = msg.setlist;
      if (pinSession && !String(pinSession.query ?? '').trim()) {
        applyPinResults(pinSession.query ?? '');
        render();
        return;
      }
      if (currentViewId === 'setlist' && !showingSettings && !statusOnly) {
        render();
        return;
      }
      if (
        currentViewId === 'admin'
        && boardMode === 'dashboard'
        && !showingSettings
        && !statusOnly
        && !editSession
        && !aliasSession
        && !pinSession
      ) {
        const nav = root?.querySelector('#admin-set-nav');
        if (nav) renderSetNav(nav, setNavCtx());
      }
      return;
    }

    if (msg.type === 'status' && msg.status) {
      lastStatus = msg.status;
      if (editSession || aliasSession || pinSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      if (currentViewId === 'setlist' && !showingSettings && !statusOnly) {
        updateSetlistLiveChrome(root, setlistChromeCtx());
        return;
      }
      if (currentViewId === 'admin' && !showingSettings && !statusOnly) {
        updateAdminChrome({ refreshClipHead: false });
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
      if (editSession || aliasSession || pinSession) {
        updateLiveChromeDuringEdit();
        return;
      }
      if (currentViewId === 'setlist' && !setlistCueChanged(prevPayload, lastPayload)) {
        updateSetlistLiveChrome(root, setlistChromeCtx());
        return;
      }
      if (currentViewId === 'breath' && !showingSettings && !statusOnly && breathCtl) {
        breathCtl.updateTransport(lastPayload);
        setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
        return;
      }
      if (
        currentViewId === 'admin'
        && boardMode === 'dashboard'
        && !showingSettings
        && !statusOnly
        && !dashboardCueChanged(prevPayload, lastPayload)
      ) {
        dashBreathCtl?.updateTransport(lastPayload);
        return;
      }
      render();
    }
  }

  function setCuePane(next) {
    cuePane = next === 'current' ? 'current' : 'last';
    writeStoredCuePane(cuePane);
    render();
  }

  function setBoardMode(next) {
    const mode = next === 'dashboard' ? 'dashboard' : 'detail';
    if (mode === boardMode) return;
    boardMode = mode;
    writeStoredAdminBoardMode(boardMode);
    if (typeof location !== 'undefined' && parseAdminBoardMode(location.search)) {
      const url = new URL(location.href);
      url.searchParams.set('mode', boardMode);
      history.replaceState(history.state, '', `${url.pathname}${url.search}`);
    }
    syncChrome();
    render();
  }

  function setSetDrawer(open) {
    const next = open === true;
    if (next === setDrawerOpen) return;
    setDrawerOpen = next;
    writeStoredAdminSetDrawer(setDrawerOpen ? 'open' : 'closed');
    if (!setDrawerOpen) resetSetNavScroll();
    render();
  }

  function setNavCtx() {
    return {
      payload: lastPayload,
      setlist: lastSetlist,
      onSwitch: (name) => mutateSetlist('/api/setlist', { method: 'PATCH', body: { name } }),
      onPin: postPin,
      onClearPin: clearPin,
      onOpenSet: (href) => {
        if (onNavigate('setlist', href) !== false) location.assign(href);
      },
      busy: saveState === 'saving' || Boolean(editSession || aliasSession || pinSession),
    };
  }

  function flashLookFields() {
    if (currentViewId === 'admin') return flattenOperatorFields(operatorViews);
    return viewConfig?.fields ?? [];
  }

  function flashLookColumns() {
    return flashableColorColumns(flashLookFields(), liveColorColumns);
  }

  function adminDashboardFlash() {
    return currentViewId === 'admin' && boardMode === 'dashboard';
  }

  function flashLookProps() {
    if (viewConfig?.editable === false && !adminDashboardFlash()) return {};
    const columns = flashLookColumns();
    return {
      onStartFlashLook: startFlashLook,
      flashLookReady: canFlashLook(lastLiveColors, columns, liveColorColumns),
      flashLookTitle: flashLookDisabledReason(lastLiveColors, columns, liveColorColumns),
      liveColorColumns,
    };
  }

  function startFlashLook() {
    if (editSession || aliasSession || pinSession) return;
    if (viewConfig?.editable === false && !adminDashboardFlash()) return;
    if (!lastPayload?.match?.matched || lastPayload.match.rowId == null) return;
    const columns = flashLookColumns();
    if (!columns.length) return;
    if (!canFlashLook(lastLiveColors, columns, liveColorColumns)) return;

    const slots = buildFlashLookSlots({
      fields: flashLookFields(),
      row: lastPayload.row,
      liveColors: lastLiveColors,
      columnMap: liveColorColumns,
      columns,
    });
    openFlashLook({
      rowId: lastPayload.match.rowId,
      cueTitle: resolveMatchedTitle(lastPayload, matchColumn) || lastPayload.clipName || 'this cue',
      slots,
      moving: isLiveColorMoving(prevLiveColors, lastLiveColors),
      onWrite: saveFlashLook,
    });
  }

  async function saveFlashLook({ rowId, changes }) {
    if (!rowId || !changes || Object.keys(changes).length === 0) {
      return { ok: false, error: 'Nothing to write' };
    }
    if (String(lastPayload?.match?.rowId) !== String(rowId)) {
      return { ok: false, error: 'Cue changed — Flash cancelled' };
    }
    try {
      const res = await fetch(`/api/sheets/rows/${encodeURIComponent(rowId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Save failed (${res.status})`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message ?? 'Save failed' };
    }
  }

  function startEdit(openColorColumn) {
    if (!lastPayload?.match?.matched || !lastPayload.row) return;
    closeFlashLook();
    if (pinSession) cancelPin();
    if (aliasSession) cancelAlias();
    const column = typeof openColorColumn === 'string' ? openColorColumn : null;
    const dashboardColor = currentViewId === 'admin' && boardMode === 'dashboard' && Boolean(column);
    const colorColumns = dashboardColor ? flashLookColumns() : null;
    const scope = colorColumns?.length
      ? { columns: colorColumns }
      : viewConfig.editable
        ? { columns: viewFieldColumns(viewConfig.fields) }
        : undefined;
    editSession = captureEditSession(lastPayload, scope);
    if (dashboardColor) editSession.dashboardColorEdit = true;
    saveState = 'idle';
    saveError = null;
    render();
    if (column) openOperatorColorField(root, column);
  }

  function startCreate(clipNameOverride, track = null) {
    const clipName = resolveCreateClipName(lastPayload, clipNameOverride);
    if (!canStartCreate(lastPayload, clipNameOverride)) return;
    if (!matchColumn) return;
    closeFlashLook();
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
    closeFlashLook();
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
    closeFlashLook();
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

  async function syncSheet() {
    if (setlistSyncing) return;
    setlistSyncing = true;
    if (currentViewId === 'setlist' && !showingSettings && !statusOnly) {
      updateSetlistLiveChrome(root, setlistChromeCtx());
    }
    try {
      const res = await fetch('/api/sheets/sync', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      saveError = null;
    } catch (err) {
      saveError = err.message ?? 'Sync failed';
    } finally {
      setlistSyncing = false;
      if (currentViewId === 'setlist' && !showingSettings && !statusOnly) {
        if (saveError) render();
        else updateSetlistLiveChrome(root, setlistChromeCtx());
      }
    }
  }

  function scheduleSetlistSearch(query) {
    if (String(query ?? '').trim()) setlistAddOpen = true;
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
      setlistCreateKey = '';
      render();
    }
  }

  async function createSetlistCueRow({ title, key } = {}) {
    if (saveState === 'saving') return;
    const changes = buildQuickCueChanges({ title, key, matchColumn });
    if (!matchColumn || !changes[matchColumn] || !String(key ?? '').trim()) return;

    saveState = 'saving';
    saveError = null;
    render();
    try {
      const createRes = await fetch('/api/sheets/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const created = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        throw new Error(created.error ?? `Create failed (${createRes.status})`);
      }
      const rowId = created.rowId;
      if (!rowId) throw new Error('Create succeeded without a row id');

      const addRes = await fetch('/api/setlist/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId }),
      });
      const added = await addRes.json().catch(() => ({}));
      if (!addRes.ok) {
        throw new Error(added.error ?? `Added cue row ${rowId}, but setlist failed (${addRes.status})`);
      }
      applySetlistState(added);
      setlistAddQuery = '';
      setlistAddResults = [];
      setlistCreateKey = '';
      saveState = 'idle';
      saveError = null;
      render();
    } catch (err) {
      saveState = 'idle';
      saveError = err.message ?? 'Create failed';
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
    abortFlashLookIfRowChanged(
      lastPayload?.match?.matched === true ? lastPayload.match.rowId : null,
    );
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
    const focusGen = ++sessionLogFocusGen;
    const sessionLogFocus = parkSessionLogMount();
    try {
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
    const getMomentWho = () => currentViewId;

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
        onPinRow: postPin,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
        getMomentWho,
      });
      paintLiveColors();
      return;
    }
    if (currentViewId === 'breath') {
      if (!breathCtl) {
        breathCtl = mountBreathPage(root, { getPayload: () => lastPayload });
      } else {
        breathCtl.updateTransport(lastPayload);
      }
      setConnectionState(connected, lastUpdate, lastPayload, serverSimulated, lastSessionLog);
      return;
    }
    if (currentViewId === 'setlist') {
      renderSetlist(root, {
        ...ctx,
        setlist: lastSetlist,
        addQuery: setlistAddQuery,
        addResults: setlistAddResults,
        addSearching: setlistAddSearching,
        addOpen: setlistAddOpen != null ? setlistAddOpen : !(lastSetlist?.items?.length),
        nameDraft: setlistNameDraft,
        saveState,
        saveError,
        syncing: setlistSyncing,
        focusRestore: setlistFocus,
        autoFocusSearch: autoFocusSetlistSearch,
        editSession,
        aliasSession,
        aliasPanel,
        pinSession,
        pinPanel,
        editorColumns,
        onAddQueryChange: scheduleSetlistSearch,
        onAddOpenChange: (open) => {
          setlistAddOpen = open === true;
          if (!open) {
            setlistAddQuery = '';
            setlistAddResults = [];
            setlistAddSearching = false;
            setlistCreateKey = '';
          } else {
            setlistAutoFocusSearch = true;
          }
          render();
        },
        onAddRow: addSetlistRow,
        createKey: setlistCreateKey,
        onCreateKeyChange: (value) => {
          setlistCreateKey = value;
          render();
        },
        onCreateCue: createSetlistCueRow,
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
        onStartEdit: startEdit,
        onStartCreate: startCreate,
        onStartAlias: startAlias,
        onStartPin: startPin,
        onPinLast: pinLastCue,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
        onSyncSheet: syncSheet,
        getMomentWho,
      });
      paintLiveColors();
      return;
    }
    if (viewConfig.system) {
      dashBreathCtl?.park?.();
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
        onPinRow: postPin,
        onClearPin: clearPin,
        getMomentWho,
        boardMode: currentViewId === 'admin' ? boardMode : 'detail',
        onBoardModeChange: currentViewId === 'admin' ? setBoardMode : undefined,
        operatorViews,
        ...(adminDashboardFlash() ? flashLookProps() : {}),
        liveColorColumns,
        setDrawerOpen,
        onSetDrawerChange: currentViewId === 'admin' ? setSetDrawer : undefined,
        cuePane,
        onCuePaneChange: setCuePane,
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
        onPinRow: postPin,
        onClearPin: clearPin,
        onStartEdit: viewConfig.editable ? startEdit : undefined,
        onStartCreate: viewConfig.editable ? startCreate : undefined,
        onStartAlias: viewConfig.editable ? startAlias : undefined,
        onCancelEdit: cancelEdit,
        onSaveEdit: saveEdit,
        getMomentWho,
        ...flashLookProps(),
        liveColorColumns,
      });
    }
    paintLiveColors();
    syncDashBreath();
    if (
      currentViewId === 'admin'
      && boardMode === 'dashboard'
      && setDrawerOpen
      && !editSession
      && !aliasSession
      && !pinSession
    ) {
      const nav = root?.querySelector('#admin-set-nav');
      if (nav) renderSetNav(nav, setNavCtx());
    }
    } finally {
      repositionSessionLogMount();
      const restoreFocus = () => {
        if (focusGen !== sessionLogFocusGen) return;
        restoreMountedFieldFocus(sessionLogFocus, document);
      };
      restoreFocus();
      void syncSessionLogPanel().then(restoreFocus);
    }
  }

  function stopDashBreath() {
    dashBreathCtl?.destroy();
    dashBreathCtl = null;
  }

  function syncDashBreath() {
    const active = currentViewId === 'admin'
      && boardMode === 'dashboard'
      && !showingSettings
      && !statusOnly
      && !editSession
      && !aliasSession
      && !pinSession;
    const host = active ? root?.querySelector('#admin-dash-breath') : null;
    if (!host) {
      stopDashBreath();
      return;
    }
    if (dashBreathCtl) {
      dashBreathCtl.attach(host);
      dashBreathCtl.updateTransport(lastPayload);
      return;
    }
    dashBreathCtl = mountBreathPreview(host, { getPayload: () => lastPayload });
  }

  function paintLiveColors() {
    if (!root || statusOnly || showingSettings) return;
    applyLiveColorOverlay(root, lastLiveColors, liveColorColumns);
    const columns = flashLookColumns();
    syncFlashLookButton(root, {
      ready: canFlashLook(lastLiveColors, columns, liveColorColumns),
      title: flashLookDisabledReason(lastLiveColors, columns, liveColorColumns),
    });
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
    const isBreath = !showingSettings && currentViewId === 'breath';
    const isAdmin = !showingSettings && viewConfig?.system === true && currentViewId === 'admin';
    const isOperator = Boolean(viewConfig)
      && !viewConfig.system
      && !statusOnly
      && !isSession
      && !isSetlist
      && !isBreath
      && !showingSettings;
    const isAdminDashboard = isAdmin && boardMode === 'dashboard';
    document.body.classList.toggle('layout-operator', isOperator);
    document.body.classList.toggle('layout-session', isSession);
    document.body.classList.toggle('layout-setlist', isSetlist);
    document.body.classList.toggle('layout-breath', isBreath);
    document.body.classList.toggle('layout-admin-dashboard', isAdminDashboard);
    document.body.classList.toggle('layout-settings', showingSettings);
    document.title = showingSettings
      ? 'AbleView — Settings'
      : `AbleView — ${viewConfig?.title ?? currentViewId}`;
    root?.classList.toggle('admin-main', isAdmin && !isAdminDashboard);
    root?.classList.toggle('admin-dashboard', isAdminDashboard);
    root?.classList.toggle('settings-main', showingSettings);
    if (showingSettings) root?.setAttribute('aria-label', 'Settings');
    else if (isAdminDashboard) root?.setAttribute('aria-label', 'Admin dashboard');
    else root?.removeAttribute('aria-label');
    const simHost = document.getElementById('sim-controls-host');
    if (simHost) simHost.hidden = showingSettings || isAdminDashboard;
    if (viewsList) {
      mountViewNav(currentViewId, viewsList, { settingsActive: showingSettings, onNavigate });
    }
    syncSessionLogPanel();
  }

  function parkSessionLogMount() {
    return parkSessionLogForRender(sessionLogMountEl, {
      viewId: currentViewId,
      doc: document,
    });
  }

  function repositionSessionLogMount() {
    if (!sessionLogKeepMounted()) return;
    placeSessionLogMount(sessionLogMountEl, {
      viewId: currentViewId,
      doc: document,
    });
  }

  function sessionLogKeepMounted() {
    return !statusOnly && !showingSettings && (
      currentViewId === 'setlist'
      || (currentViewId === 'admin' && boardMode === 'dashboard')
    );
  }

  async function syncSessionLogPanel() {
    const pageHost = document.getElementById('session-log');
    if (pageHost) {
      pageHost.hidden = currentViewId !== 'setlist' || showingSettings || statusOnly;
    }

    if (!sessionLogKeepMounted()) {
      sessionLogGen += 1;
      unmountSessionLog?.();
      unmountSessionLog = null;
      sessionLogMountEl?.remove();
      sessionLogMountEl = null;
      return;
    }

    const gen = ++sessionLogGen;
    const { ensureSessionLogHost, mountSessionLogPanel } = await import('./admin-session-log.js');
    if (gen !== sessionLogGen) return;

    let target = null;
    if (currentViewId === 'setlist') {
      target = ensureSessionLogHost(root).host;
      if (target) target.hidden = false;
    } else {
      target = document.getElementById('admin-set-log');
    }

    if (!sessionLogMountEl || !unmountSessionLog) {
      sessionLogMountEl = document.createElement('div');
      sessionLogMountEl.className = 'set-log-mount';
      unmountSessionLog?.();
      unmountSessionLog = mountSessionLogPanel(sessionLogMountEl, {
        getWho: () => currentViewId,
      });
    }
    if (target && sessionLogMountEl.parentNode !== target) {
      target.appendChild(sessionLogMountEl);
    }
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
    settingsOverlay?.unmount?.();
    settingsOverlay = null;
    document.body.classList.remove('layout-settings');
    root?.classList.remove('settings-main');
    root?.removeAttribute('aria-label');
  }

  async function enterSettings(href, historyMode) {
    if (showingSettings && settingsOverlay) return;
    showingSettings = true;
    breathCtl?.destroy();
    breathCtl = null;
    stopDashBreath();
    closeColorPicker();
    closeFlashLook();
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
    settingsOverlay?.unmount?.();
    settingsOverlay = attachSettingsOverlay(root);
    if (lastLiveColors) settingsOverlay?.applyLiveColors?.(lastLiveColors);
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
    if (nextId !== 'breath') {
      breathCtl?.destroy();
      breathCtl = null;
    }
    if (nextId !== 'admin') stopDashBreath();
    if (nextId === currentViewId) {
      syncChrome();
      render();
      return;
    }
    currentViewId = nextId;
    closeFlashLook();
    editSession = null;
    aliasSession = null;
    pinSession = null;
    saveState = 'idle';
    saveError = null;
    setlistAddQuery = '';
    setlistAddResults = [];
    setlistAddSearching = false;
    setlistAddOpen = null;
    setlistCreateKey = '';
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
      sessionLogMountEl?.remove();
      sessionLogMountEl = null;
      leaveSettings();
      breathCtl?.destroy();
      breathCtl = null;
      stopDashBreath();
      window.removeEventListener('popstate', onPopState);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
