// Admin 16:9 board: union of operator field maps, grouped by kind (not by view chrome).

export const ADMIN_BOARD_MODES = Object.freeze(['dashboard', 'detail']);
export const ADMIN_BOARD_STORAGE_KEY = 'ableview.adminMode';
export const ADMIN_BOARD_QUERY = 'mode';

/** Identity tokens on the board masthead. Tempo lives in the status bar. */
const DASHBOARD_TOKEN_PATTERN = /^(key|relative key|bpm)$/i;

export function normalizeAdminBoardMode(value) {
  return value === 'dashboard' || value === 'detail' ? value : null;
}

export function parseAdminBoardMode(search) {
  const params = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  return normalizeAdminBoardMode(params.get(ADMIN_BOARD_QUERY));
}

/**
 * URL `?mode=` wins, then stored preference, then kiosk → dashboard, else detail.
 * @param {{ search?: string, stored?: string|null, kiosk?: boolean }} opts
 */
export function resolveAdminBoardMode({ search = '', stored = null, kiosk = false } = {}) {
  return parseAdminBoardMode(search)
    ?? normalizeAdminBoardMode(stored)
    ?? (kiosk ? 'dashboard' : 'detail');
}

export function readStoredAdminBoardMode(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return normalizeAdminBoardMode(store?.getItem(ADMIN_BOARD_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredAdminBoardMode(mode, storage) {
  const next = normalizeAdminBoardMode(mode);
  if (!next) return;
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    store?.setItem(ADMIN_BOARD_STORAGE_KEY, next);
  } catch {
    // private mode / disabled storage
  }
}

export const ADMIN_SET_DRAWER_STORAGE_KEY = 'ableview.adminSetDrawer';
export const ADMIN_SET_DRAWER_WIDE_QUERY = '(min-width: 64rem)';

export function normalizeAdminSetDrawer(value) {
  return value === 'open' || value === 'closed' ? value : null;
}

export function isWideAdminViewport(win) {
  try {
    const media = win?.matchMedia?.(ADMIN_SET_DRAWER_WIDE_QUERY);
    return Boolean(media?.matches);
  } catch {
    return false;
  }
}

/**
 * Stored preference wins, then kiosk / wide viewport → open, else closed.
 * @param {{ stored?: string|null, kiosk?: boolean, wide?: boolean }} opts
 */
export function resolveAdminSetDrawer({ stored = null, kiosk = false, wide = false } = {}) {
  return normalizeAdminSetDrawer(stored)
    ?? ((kiosk || wide) ? 'open' : 'closed');
}

export function readStoredAdminSetDrawer(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return normalizeAdminSetDrawer(store?.getItem(ADMIN_SET_DRAWER_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeStoredAdminSetDrawer(state, storage) {
  const next = normalizeAdminSetDrawer(state);
  if (!next) return;
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    store?.setItem(ADMIN_SET_DRAWER_STORAGE_KEY, next);
  } catch {
    // private mode / disabled storage
  }
}

export function withAdminBoardMode(path, mode, search) {
  const url = new URL(path, 'http://ableview.local');
  const fromSearch = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  if (fromSearch.get('kiosk') != null && !url.searchParams.has('kiosk')) {
    url.searchParams.set('kiosk', fromSearch.get('kiosk') || '1');
  }
  const next = normalizeAdminBoardMode(mode);
  if (next) url.searchParams.set(ADMIN_BOARD_QUERY, next);
  else url.searchParams.delete(ADMIN_BOARD_QUERY);
  return `${url.pathname}${url.search}`;
}

export function fieldIdentity(field) {
  if (field?.source) return `source:${field.source}`;
  if (field?.type === 'camelot' && field?.column) return `column:${field.column}:camelot`;
  if (field?.column) return `column:${field.column}`;
  return null;
}

export function collectOperatorViews(views) {
  if (Array.isArray(views)) {
    return views
      .filter((v) => v && !v.system && Array.isArray(v.fields) && v.fields.length)
      .map((v) => ({
        id: String(v.id ?? ''),
        title: v.title ?? String(v.id ?? ''),
        fields: v.fields,
      }))
      .filter((v) => v.id);
  }
  return Object.entries(views ?? {})
    .filter(([, v]) => v && !v.system && Array.isArray(v.fields) && v.fields.length)
    .map(([id, v]) => ({
      id,
      title: v.title ?? id,
      fields: v.fields,
    }));
}

export function flattenOperatorFields(operatorViews) {
  const seen = new Set();
  const out = [];
  for (const view of operatorViews ?? []) {
    for (const field of view.fields ?? []) {
      const id = fieldIdentity(field);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(field);
    }
  }
  return out;
}

/** @returns {'skip' | 'token' | 'color' | 'image' | 'note' | 'camelot'} */
export function dashboardFieldKind(field) {
  if (!field || field.source === 'tempo') return 'skip';
  if (field.type === 'camelot') return 'camelot';
  if (field.type === 'color') return 'color';
  if (field.type === 'image') return 'image';
  const column = String(field.column ?? '').trim();
  const label = String(field.label ?? '').trim();
  if (DASHBOARD_TOKEN_PATTERN.test(column) || DASHBOARD_TOKEN_PATTERN.test(label)) {
    return 'token';
  }
  return 'note';
}

/**
 * Deduped zones for the 16:9 board. Note groups keep their source view title
 * so Viz vs Lighting notes sit in separate columns without repeating RGB.
 */
export function buildDashboardZones(operatorViews) {
  const seen = new Set();
  const tokens = [];
  const images = [];
  const colors = [];
  const camelot = [];
  const noteGroups = [];

  for (const view of operatorViews ?? []) {
    const notes = [];
    for (const field of view.fields ?? []) {
      const kind = dashboardFieldKind(field);
      if (kind === 'skip') continue;
      const id = fieldIdentity(field);
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (kind === 'token') tokens.push(field);
      else if (kind === 'image') images.push(field);
      else if (kind === 'color') colors.push(field);
      else if (kind === 'camelot') camelot.push(field);
      else notes.push(field);
    }
    if (notes.length) {
      noteGroups.push({
        id: view.id,
        title: view.title ?? view.id,
        fields: notes,
      });
    }
  }

  return { tokens, images, colors, camelot, noteGroups };
}
