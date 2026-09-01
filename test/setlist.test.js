import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import {
  createSetlistStore,
  currentSetlistRowId,
  sanitizeSetlistName,
  SIDECAR_NAME,
} from '../src/setlist/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const SHEET_ROWS = [
  { rowId: '5', data: { 'Song Title': 'Song A' } },
  { rowId: '7', data: { 'Song Title': 'Song B' } },
  { rowId: '9', data: { 'Song Title': 'Song C' } },
];

function snapshot(rows = SHEET_ROWS) {
  return {
    matchColumn: 'Song Title',
    rows,
  };
}

function tempStore(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-'));
  const config = {
    ...DEFAULTS,
    setlist: {
      directory: dir,
      defaultName: 'default',
      ...overrides.setlist,
    },
  };
  const bus = overrides.bus ?? createBus();
  let sheet = overrides.snapshot ?? snapshot();
  const store = createSetlistStore({
    getConfig: () => config,
    getSnapshot: () => sheet,
    bus,
    log: silentLog,
    cwd: process.cwd(),
  });
  return {
    store,
    dir,
    bus,
    setSnapshot(next) {
      sheet = next;
    },
  };
}

test('sanitizeSetlistName rejects path traversal and dotfiles', () => {
  assert.throws(() => sanitizeSetlistName('../evil'), /non-empty string/);
  assert.throws(() => sanitizeSetlistName(''), /non-empty string/);
  assert.throws(() => sanitizeSetlistName('.active'), /non-empty string/);
  assert.equal(sanitizeSetlistName('  festival saturday  '), 'festival-saturday');
});

test('currentSetlistRowId is null when unmatched (NFR-7)', () => {
  assert.equal(currentSetlistRowId(null), null);
  assert.equal(currentSetlistRowId({ match: { matched: false, rowId: '5' } }), null);
  assert.equal(currentSetlistRowId({ match: { matched: true, rowId: '5' } }), '5');
  assert.equal(currentSetlistRowId({ match: { matched: true, rowId: 7, viaOverride: true } }), '7');
});

test('start creates default setlist and sidecar', () => {
  const { store, dir } = tempStore();
  store.start();
  const state = store.getState();
  assert.equal(state.name, 'default');
  assert.equal(state.items.length, 0);
  assert.equal(existsSync(join(dir, 'default.json')), true);
  assert.equal(existsSync(join(dir, SIDECAR_NAME)), true);
  const sidecar = JSON.parse(readFileSync(join(dir, SIDECAR_NAME), 'utf8'));
  assert.equal(sidecar.setlistName, 'default');
});

test('add / reorder / status / remove persist to disk', () => {
  const { store, dir } = tempStore();
  store.start();
  store.addItem('5');
  store.addItem('7', 'maybe');
  let state = store.getState();
  assert.equal(state.items.length, 2);
  assert.equal(state.items[0].rowId, '5');
  assert.equal(state.items[0].title, 'Song A');
  assert.equal(state.items[0].status, 'confirmed');
  assert.equal(state.items[1].status, 'maybe');
  assert.equal(state.items[0].missing, false);

  store.reorder(['7', '5']);
  store.setItemStatus('7', 'likely');
  store.removeItem('5');
  state = store.getState();
  assert.deepEqual(state.items.map((i) => i.rowId), ['7']);
  assert.equal(state.items[0].status, 'likely');

  const saved = JSON.parse(readFileSync(join(dir, 'default.json'), 'utf8'));
  assert.equal(saved.items[0].rowId, '7');
  assert.equal(saved.items[0].liveTitle, undefined);
});

test('duplicate rowId is rejected', () => {
  const { store } = tempStore();
  store.start();
  store.addItem('5');
  assert.throws(() => store.addItem('5'), /already on setlist/);
});

test('unknown sheet row is rejected', () => {
  const { store } = tempStore();
  store.start();
  assert.throws(() => store.addItem('99'), /row not found/);
});

test('hydrate marks missing rows when the sheet snapshot drops them', () => {
  const { store, setSnapshot } = tempStore();
  store.start();
  store.addItem('5');
  setSnapshot(snapshot([]));
  const state = store.getState();
  assert.equal(state.items[0].missing, true);
  assert.equal(state.items[0].title, 'Song A');
});

test('switch, create, and duplicate named setlists', () => {
  const { store, dir } = tempStore();
  store.start();
  store.addItem('5');
  store.duplicate('festival-saturday');
  assert.equal(store.getState().name, 'festival-saturday');
  assert.equal(store.getState().items[0].rowId, '5');
  assert.equal(existsSync(join(dir, 'festival-saturday.json')), true);

  store.createNew('club-warmup');
  assert.equal(store.getState().name, 'club-warmup');
  assert.equal(store.getState().items.length, 0);

  store.switchTo('festival-saturday');
  assert.equal(store.getState().name, 'festival-saturday');
  assert.equal(store.getState().items.length, 1);

  const library = store.getState().library.map((e) => e.name).sort();
  assert.deepEqual(library, ['club-warmup', 'default', 'festival-saturday']);

  assert.throws(() => store.createNew('festival-saturday'), /already exists/);
  assert.throws(() => store.switchTo('missing-show'), /not found/);
});

test('restart restores the active setlist from the sidecar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-restore-'));
  const config = {
    ...DEFAULTS,
    setlist: { directory: dir, defaultName: 'default' },
  };
  const snap = snapshot();
  const first = createSetlistStore({
    getConfig: () => config,
    getSnapshot: () => snap,
    log: silentLog,
  });
  first.start();
  first.addItem('7', 'likely');
  first.duplicate('show-night');
  first.stop();

  const second = createSetlistStore({
    getConfig: () => config,
    getSnapshot: () => snap,
    log: silentLog,
  });
  second.start();
  const state = second.getState();
  assert.equal(state.name, 'show-night');
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].rowId, '7');
  assert.equal(state.items[0].status, 'likely');
});

test('store emits SETLIST on the bus', () => {
  const bus = createBus();
  const seen = [];
  bus.on(EVENTS.SETLIST, (state) => seen.push(state.name));
  const { store } = tempStore({ bus });
  store.start();
  store.addItem('5');
  assert.ok(seen.includes('default'));
});
