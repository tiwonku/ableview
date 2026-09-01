import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EVENTS } from '../core/bus.js';
import { sanitizeSessionName } from '../session-log/sanitize.js';

export const SETLIST_STATUSES = Object.freeze(['confirmed', 'likely', 'maybe']);
export const DEFAULT_SETLIST_STATUS = 'confirmed';
export const SIDECAR_NAME = '.active.json';

export function sanitizeSetlistName(raw) {
  let name;
  try {
    name = sanitizeSessionName(raw);
  } catch {
    throw new Error('Setlist name must be a non-empty string');
  }
  if (name.startsWith('.')) {
    throw new Error('Setlist name must be a non-empty string');
  }
  return name;
}

/** Live-board rowId when a cue is showing (auto-match or pin). Null when unmatched (NFR-7). */
export function currentSetlistRowId(payload) {
  if (payload?.match?.matched !== true) return null;
  const id = payload.match.rowId;
  return id != null && String(id).trim() !== '' ? String(id) : null;
}

export function setlistFilePath(directory, setlistName, cwd = process.cwd()) {
  const dir = resolve(cwd, directory);
  const file = resolve(dir, `${setlistName}.json`);
  if (!file.startsWith(dir)) {
    throw new Error('Invalid setlist file path');
  }
  return { dir, file, relative: join(directory, `${setlistName}.json`) };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function emptyDocument(name) {
  return {
    name,
    updatedAt: new Date().toISOString(),
    items: [],
  };
}

function normalizeItem(raw) {
  const rowId = raw?.rowId != null ? String(raw.rowId).trim() : '';
  if (!rowId) return null;
  const status = SETLIST_STATUSES.includes(raw.status) ? raw.status : DEFAULT_SETLIST_STATUS;
  const title = String(raw.title ?? '').trim();
  return { rowId, title, status };
}

function normalizeDocument(parsed, fallbackName) {
  const name = parsed?.name ? sanitizeSetlistName(String(parsed.name)) : fallbackName;
  const items = [];
  const seen = new Set();
  for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
    const item = normalizeItem(raw);
    if (!item || seen.has(item.rowId)) continue;
    seen.add(item.rowId);
    items.push(item);
  }
  return {
    name,
    updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    items,
  };
}

function persistableDocument(doc) {
  return {
    name: doc.name,
    updatedAt: doc.updatedAt,
    items: doc.items.map((item) => ({
      rowId: item.rowId,
      title: item.title,
      status: item.status,
    })),
  };
}

function titleFromRow(row, matchColumn) {
  if (!row?.data || typeof row.data !== 'object') return '';
  if (matchColumn) return String(row.data[matchColumn] ?? '').trim();
  return '';
}

function findSheetRow(snapshot, rowId) {
  const id = String(rowId);
  return snapshot?.rows?.find((r) => String(r.rowId) === id) ?? null;
}

export function createSetlistStore({
  getConfig,
  getSnapshot,
  bus,
  log,
  cwd = process.cwd(),
  onChange,
}) {
  let document = emptyDocument('default');
  let changeHandler = onChange ?? null;

  function setlistConfig() {
    return getConfig().setlist ?? {};
  }

  function directory() {
    return setlistConfig().directory ?? './data/setlists';
  }

  function defaultName() {
    try {
      return sanitizeSetlistName(setlistConfig().defaultName ?? 'default');
    } catch {
      return 'default';
    }
  }

  function sidecarPath() {
    const { dir } = setlistFilePath(directory(), 'x', cwd);
    return resolve(dir, SIDECAR_NAME);
  }

  function notify() {
    const state = getState();
    changeHandler?.(state);
    bus?.emit(EVENTS.SETLIST, state);
  }

  function persistSidecar() {
    writeJson(sidecarPath(), {
      setlistName: document.name,
      fileName: `${document.name}.json`,
    });
  }

  function persistDocument() {
    const { file } = setlistFilePath(directory(), document.name, cwd);
    writeJson(file, persistableDocument(document));
    persistSidecar();
  }

  function loadFile(name) {
    const { file } = setlistFilePath(directory(), name, cwd);
    if (!existsSync(file)) {
      throw new Error(`setlist not found: ${name}`);
    }
    const parsed = readJson(file);
    document = normalizeDocument(parsed, name);
    document.name = name;
  }

  function createAndLoad(name) {
    document = emptyDocument(name);
    persistDocument();
  }

  function listLibrary() {
    const { dir } = setlistFilePath(directory(), 'x', cwd);
    if (!existsSync(dir)) return [];
    const names = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
      const name = entry.slice(0, -'.json'.length);
      try {
        sanitizeSetlistName(name);
      } catch {
        continue;
      }
      let updatedAt = null;
      let itemCount = 0;
      try {
        const parsed = readJson(resolve(dir, entry));
        const doc = normalizeDocument(parsed, name);
        updatedAt = doc.updatedAt;
        itemCount = doc.items.length;
      } catch {
        continue;
      }
      names.push({ name, updatedAt, itemCount });
    }
    names.sort((a, b) => {
      if (a.name === document.name) return -1;
      if (b.name === document.name) return 1;
      return a.name.localeCompare(b.name);
    });
    return names;
  }

  function hydrateItem(item) {
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const found = findSheetRow(snapshot, item.rowId);
    const liveTitle = titleFromRow(found, snapshot?.matchColumn);
    return {
      rowId: item.rowId,
      title: item.title,
      status: item.status,
      liveTitle: liveTitle || null,
      missing: !found,
    };
  }

  function getState() {
    return {
      name: document.name,
      updatedAt: document.updatedAt,
      itemCount: document.items.length,
      items: document.items.map(hydrateItem),
      library: listLibrary(),
    };
  }

  function stampAndPersist() {
    document = { ...document, updatedAt: new Date().toISOString() };
    persistDocument();
    notify();
    return getState();
  }

  function lookupSheetRow(rowId) {
    const id = rowId != null ? String(rowId).trim() : '';
    if (!id) throw new Error('rowId is required');
    const snapshot = typeof getSnapshot === 'function' ? getSnapshot() : null;
    const found = findSheetRow(snapshot, id);
    if (!found) throw new Error(`row not found: ${id}`);
    const title = titleFromRow(found, snapshot?.matchColumn) || id;
    return { rowId: String(found.rowId), title };
  }

  function addItem(rowId, status = DEFAULT_SETLIST_STATUS) {
    const resolved = lookupSheetRow(rowId);
    if (document.items.some((item) => item.rowId === resolved.rowId)) {
      const err = new Error(`already on setlist: ${resolved.rowId}`);
      err.code = 'conflict';
      throw err;
    }
    const nextStatus = SETLIST_STATUSES.includes(status) ? status : DEFAULT_SETLIST_STATUS;
    document.items = [
      ...document.items,
      { rowId: resolved.rowId, title: resolved.title, status: nextStatus },
    ];
    log?.info({ rowId: resolved.rowId, name: document.name }, 'setlist item added');
    return stampAndPersist();
  }

  function removeItem(rowId) {
    const id = rowId != null ? String(rowId).trim() : '';
    if (!id) throw new Error('rowId is required');
    const next = document.items.filter((item) => item.rowId !== id);
    if (next.length === document.items.length) {
      throw new Error(`item not on setlist: ${id}`);
    }
    document.items = next;
    log?.info({ rowId: id, name: document.name }, 'setlist item removed');
    return stampAndPersist();
  }

  function setItemStatus(rowId, status) {
    const id = rowId != null ? String(rowId).trim() : '';
    if (!id) throw new Error('rowId is required');
    if (!SETLIST_STATUSES.includes(status)) {
      throw new Error(`status must be one of: ${SETLIST_STATUSES.join(', ')}`);
    }
    const index = document.items.findIndex((item) => item.rowId === id);
    if (index < 0) throw new Error(`item not on setlist: ${id}`);
    const items = document.items.slice();
    items[index] = { ...items[index], status };
    document.items = items;
    return stampAndPersist();
  }

  function reorder(rowIds) {
    if (!Array.isArray(rowIds)) throw new Error('order must be an array of rowIds');
    const wanted = rowIds.map((id) => String(id).trim()).filter(Boolean);
    const currentIds = document.items.map((item) => item.rowId);
    if (wanted.length !== currentIds.length) {
      throw new Error('order must include each current item once');
    }
    const seen = new Set();
    for (const id of wanted) {
      if (seen.has(id) || !currentIds.includes(id)) {
        throw new Error('order must include each current item once');
      }
      seen.add(id);
    }
    const byId = new Map(document.items.map((item) => [item.rowId, item]));
    document.items = wanted.map((id) => byId.get(id));
    return stampAndPersist();
  }

  function switchTo(name) {
    const next = sanitizeSetlistName(name);
    if (next === document.name) return getState();
    loadFile(next);
    persistSidecar();
    log?.info({ name: next }, 'setlist switched');
    notify();
    return getState();
  }

  function createNew(name) {
    const next = sanitizeSetlistName(name);
    const { file } = setlistFilePath(directory(), next, cwd);
    if (existsSync(file)) {
      const err = new Error(`setlist already exists: ${next}`);
      err.code = 'conflict';
      throw err;
    }
    createAndLoad(next);
    log?.info({ name: next }, 'setlist created');
    notify();
    return getState();
  }

  function duplicate(name) {
    const next = sanitizeSetlistName(name);
    const { file } = setlistFilePath(directory(), next, cwd);
    if (existsSync(file)) {
      const err = new Error(`setlist already exists: ${next}`);
      err.code = 'conflict';
      throw err;
    }
    document = {
      name: next,
      updatedAt: new Date().toISOString(),
      items: document.items.map((item) => ({ ...item })),
    };
    persistDocument();
    log?.info({ name: next }, 'setlist duplicated');
    notify();
    return getState();
  }

  function start() {
    const { dir } = setlistFilePath(directory(), 'x', cwd);
    mkdirSync(dir, { recursive: true });

    let restored = null;
    try {
      if (existsSync(sidecarPath())) {
        const sidecar = readJson(sidecarPath());
        if (sidecar?.setlistName) restored = sanitizeSetlistName(String(sidecar.setlistName));
      }
    } catch {
      restored = null;
    }

    const fallback = defaultName();
    const tryNames = [restored, fallback].filter(Boolean);
    let loaded = false;
    for (const name of tryNames) {
      try {
        loadFile(name);
        loaded = true;
        break;
      } catch {
        // missing file — try next
      }
    }
    if (!loaded) {
      createAndLoad(fallback);
    } else {
      persistSidecar();
    }
    log?.info({ name: document.name, items: document.items.length }, 'setlist loaded');
    notify();
  }

  function stop() {
    try {
      persistDocument();
    } catch {
      // shutdown persist is best-effort
    }
  }

  return {
    start,
    stop,
    getState,
    addItem,
    removeItem,
    setItemStatus,
    reorder,
    switchTo,
    createNew,
    duplicate,
    refresh: notify,
    setOnChange(handler) {
      changeHandler = handler ?? null;
    },
  };
}
