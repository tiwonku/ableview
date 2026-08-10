import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { google } from 'googleapis';
import { parseSheetGrid, getMatchValues } from './parse.js';
import {
  buildAppendRowValues,
  buildExplicitRowRange,
  nextAppendRow,
  appendSnapshotRow,
  snapshotRowData,
} from './append-row.js';
import { buildRowUpdateRanges, formatChangesForSheet, patchSnapshotRow } from './update-row.js';
import { assertAliasColumnPresent, mergeAliasValue } from './aliases.js';
import { searchSheetRows } from './search-rows.js';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function readCacheFile(cachePath) {
  const raw = readFileSync(cachePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.rows)) {
    throw new Error('cache file missing rows array');
  }
  return parsed;
}

function writeCacheFile(cachePath, snapshot) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

export function createSheetsStore({ config, getConfig, log }) {
  const resolveConfig = getConfig ?? (() => config);

  let snapshot = {
    syncedAt: null,
    stale: true,
    worksheet: resolveConfig().sheets.worksheet,
    headerRow: resolveConfig().sheets.headerRow,
    matchColumn: resolveConfig().sheets.matchColumn,
    aliasColumn: resolveConfig().sheets.aliasColumn,
    headers: [],
    rows: [],
  };
  let refreshTimer = null;

  function sheetSettings() {
    return resolveConfig().sheets;
  }

  function cachePath() {
    return resolve(process.cwd(), sheetSettings().cacheFile);
  }

  function applyParsed({ headers, rows }, { syncedAt, stale }) {
    const { worksheet, headerRow, matchColumn, aliasColumn } = sheetSettings();
    snapshot = {
      syncedAt,
      stale,
      worksheet,
      headerRow,
      matchColumn,
      aliasColumn,
      headers,
      rows,
    };
  }

  function loadFromCache() {
    try {
      const cached = readCacheFile(cachePath());
      applyParsed(
        { headers: cached.headers ?? [], rows: cached.rows ?? [] },
        { syncedAt: cached.syncedAt ?? null, stale: true }
      );
      log.info({ rows: snapshot.rows.length, syncedAt: snapshot.syncedAt }, 'loaded sheet from cache');
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      log.warn({ err: err.message }, 'failed to read sheet cache');
      return false;
    }
  }

  function persistCache() {
    try {
      writeCacheFile(cachePath(), snapshot);
    } catch (err) {
      log.error({ err: err.message }, 'failed to write sheet cache');
    }
  }

  function sheetsClient() {
    const cfg = resolveConfig();
    const keyPath = cfg.secrets.googleServiceAccountKeyPath;
    const sheetId = cfg.secrets.sheetId;
    if (!keyPath || !sheetId) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH and SHEET_ID are required for sheet sync');
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: resolve(process.cwd(), keyPath),
      scopes: [SHEETS_SCOPE],
    });
    return { client: google.sheets({ version: 'v4', auth }), sheetId };
  }

  async function fetchFromGoogle() {
    const { worksheet, headerRow } = sheetSettings();
    const { client, sheetId } = sheetsClient();
    const range = `'${worksheet.replace(/'/g, "''")}'!A:ZZ`;

    const res = await client.spreadsheets.values.get({ spreadsheetId: sheetId, range });
    const parsed = parseSheetGrid(res.data.values ?? [], { headerRow });
    const syncedAt = new Date().toISOString();

    applyParsed(parsed, { syncedAt, stale: false });
    persistCache();
    log.info(
      { rows: snapshot.rows.length, headerRow, worksheet, syncedAt },
      'sheet synced from Google'
    );
  }

  async function updateRow(rowId, changes) {
    const row = snapshot.rows.find((r) => r.rowId === String(rowId));
    if (!row) throw new Error(`row not found: ${rowId}`);

    const { editorColumns = {} } = sheetSettings();
    const formatted = formatChangesForSheet(changes, editorColumns, snapshot.headers);
    if (Object.keys(formatted).length === 0) {
      throw new Error('no changes provided');
    }

    const { client, sheetId } = sheetsClient();
    const { worksheet } = sheetSettings();
    const data = buildRowUpdateRanges({
      worksheet,
      headers: snapshot.headers,
      rowId,
      changes: formatted,
    });

    await client.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data,
      },
    });

    patchSnapshotRow(snapshot, rowId, formatted);
    snapshot.syncedAt = new Date().toISOString();
    snapshot.stale = false;
    persistCache();
    log.info({ rowId, columns: Object.keys(formatted) }, 'sheet row updated');
  }

  async function appendRow(changes) {
    if (!snapshot.headers.length) {
      throw new Error('sheet headers not loaded');
    }

    const { matchColumn, editorColumns = {} } = sheetSettings();
    const formatted = formatChangesForSheet(changes, editorColumns, snapshot.headers);
    if (!formatted[matchColumn]?.trim()) {
      throw new Error(`${matchColumn} is required`);
    }

    const { client, sheetId } = sheetsClient();
    const { worksheet, headerRow } = sheetSettings();
    const rowValues = buildAppendRowValues(snapshot.headers, formatted);
    const rowId = String(nextAppendRow({ rows: snapshot.rows, headerRow }));
    const range = buildExplicitRowRange(worksheet, rowId, snapshot.headers);

    await client.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [rowValues] },
    });

    const data = snapshotRowData(snapshot.headers, rowValues);
    appendSnapshotRow(snapshot, rowId, data);
    snapshot.syncedAt = new Date().toISOString();
    snapshot.stale = false;
    persistCache();
    log.info({ rowId, columns: Object.keys(formatted) }, 'sheet row appended');
    return { rowId, row: data };
  }

  function searchRows(query, { limit = 15 } = {}) {
    const { matchColumn, aliasColumn } = sheetSettings();
    const secondaryColumns = snapshot.headers.includes('ALS Folder') ? ['ALS Folder'] : [];
    return searchSheetRows(snapshot, {
      query,
      matchColumn,
      aliasColumn,
      secondaryColumns,
      limit,
    });
  }

  async function appendAlias(rowId, alias) {
    const aliasColumn = assertAliasColumnPresent(snapshot, sheetSettings().aliasColumn);
    const row = snapshot.rows.find((r) => r.rowId === String(rowId));
    if (!row) throw new Error(`row not found: ${rowId}`);

    const merged = mergeAliasValue(row.data[aliasColumn], alias);
    if (!merged.added) {
      return {
        rowId: String(rowId),
        row: row.data,
        alias: String(alias).trim(),
        aliases: merged.aliases,
        added: false,
      };
    }

    await updateRow(rowId, { [aliasColumn]: merged.value });
    const updated = snapshot.rows.find((r) => r.rowId === String(rowId));
    log.info({ rowId, alias: String(alias).trim(), aliasColumn }, 'alias appended to sheet row');
    return {
      rowId: String(rowId),
      row: updated?.data ?? row.data,
      alias: String(alias).trim(),
      aliases: merged.aliases,
      added: true,
    };
  }

  async function sync() {
    try {
      await fetchFromGoogle();
    } catch (err) {
      log.error({ err: err.message }, 'sheet sync failed');
      snapshot.stale = true;
      if (snapshot.rows.length === 0) {
        loadFromCache();
      }
      throw err;
    }
  }

  function getClipNames() {
    return getMatchValues(snapshot.rows, sheetSettings().matchColumn);
  }

  function getSnapshot() {
    return { ...snapshot };
  }

  function startRefreshTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    const { refreshSeconds } = sheetSettings();
    refreshTimer = setInterval(() => {
      sync().catch(() => {});
    }, refreshSeconds * 1000);
  }

  async function start() {
    loadFromCache();

    const cfg = resolveConfig();
    const hasCredentials = cfg.secrets.googleServiceAccountKeyPath && cfg.secrets.sheetId;

    if (hasCredentials) {
      try {
        await sync();
      } catch {
        // Already logged; continue serving cache if available.
      }
      startRefreshTimer();
    } else if (snapshot.rows.length === 0) {
      log.warn('sheet sync skipped: set GOOGLE_SERVICE_ACCOUNT_KEY_PATH and SHEET_ID in .env');
    } else {
      log.warn('sheet sync skipped (no credentials); serving stale cache');
    }
  }

  function stop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
  }

  function applySettings() {
    const { worksheet, headerRow, matchColumn, aliasColumn } = sheetSettings();
    snapshot = { ...snapshot, worksheet, headerRow, matchColumn, aliasColumn, stale: true };
    stop();
    startRefreshTimer();
    sync().catch(() => {});
  }

  return {
    start,
    stop,
    sync,
    updateRow,
    appendRow,
    appendAlias,
    searchRows,
    getClipNames,
    getSnapshot,
    applySettings,
  };
}
