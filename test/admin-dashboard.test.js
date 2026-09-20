import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildDashboardZones,
  collectOperatorViews,
  dashboardFieldKind,
  fieldIdentity,
  flattenOperatorFields,
  isWideAdminViewport,
  normalizeAdminBoardMode,
  normalizeAdminSetDrawer,
  parseAdminBoardMode,
  readStoredAdminBoardMode,
  readStoredAdminSetDrawer,
  resolveAdminBoardMode,
  resolveAdminSetDrawer,
  withAdminBoardMode,
  writeStoredAdminBoardMode,
  writeStoredAdminSetDrawer,
  ADMIN_BOARD_STORAGE_KEY,
  ADMIN_SET_DRAWER_STORAGE_KEY,
} from '../public/shared/admin-dashboard.js';

const exampleViews = {
  band: {
    title: 'Band',
    fields: [
      { column: 'Key', display: 'token' },
      { column: 'Key', type: 'camelot', label: 'Harmony' },
      { source: 'tempo', label: 'Tempo', display: 'token' },
    ],
  },
  visuals: {
    title: 'Visuals',
    fields: [
      { column: 'ART', label: 'Album Art', type: 'image' },
      { column: 'RGB_1', label: 'Color 1', type: 'color' },
      { column: 'RGB_2', label: 'Color 2', type: 'color' },
      { column: 'RGB_3', label: 'Color 3', type: 'color' },
      { column: 'Viz Notes', display: 'note' },
      { column: 'VIBE TAGS', label: 'Vibe Tags', display: 'note' },
    ],
  },
  lighting: {
    title: 'Lighting',
    fields: [
      { source: 'tempo', label: 'Tempo', display: 'token' },
      { column: 'Lasers' },
      { column: 'Lighting Notes', display: 'note' },
      { column: 'RGB_1', label: 'Color 1', type: 'color' },
      { column: 'RGB_2', label: 'Color 2', type: 'color' },
      { column: 'RGB_3', label: 'Color 3', type: 'color' },
      { column: 'Automation' },
    ],
  },
  session: { title: 'Session', system: true },
  admin: { title: 'Admin', system: true },
};

test('resolveAdminBoardMode prefers URL, then storage, then kiosk default', () => {
  assert.equal(resolveAdminBoardMode({ search: '?mode=dashboard', stored: 'detail', kiosk: false }), 'dashboard');
  assert.equal(resolveAdminBoardMode({ search: '?mode=detail', stored: 'dashboard', kiosk: true }), 'detail');
  assert.equal(resolveAdminBoardMode({ search: '', stored: 'dashboard', kiosk: false }), 'dashboard');
  assert.equal(resolveAdminBoardMode({ search: '', stored: null, kiosk: true }), 'dashboard');
  assert.equal(resolveAdminBoardMode({ search: '', stored: null, kiosk: false }), 'detail');
  assert.equal(resolveAdminBoardMode({ search: '?mode=nope', stored: 'bogus', kiosk: false }), 'detail');
});

test('parseAdminBoardMode and withAdminBoardMode keep kiosk', () => {
  assert.equal(parseAdminBoardMode('?kiosk=1&mode=dashboard'), 'dashboard');
  assert.equal(parseAdminBoardMode('?kiosk=1'), null);
  assert.equal(normalizeAdminBoardMode('dashboard'), 'dashboard');
  assert.equal(normalizeAdminBoardMode('sheet'), null);
  assert.equal(
    withAdminBoardMode('/views/admin', 'dashboard', '?kiosk=1'),
    '/views/admin?kiosk=1&mode=dashboard',
  );
  assert.equal(withAdminBoardMode('/views/admin', 'detail', ''), '/views/admin?mode=detail');
});

test('resolveAdminSetDrawer prefers storage, then kiosk or wide viewport', () => {
  assert.equal(resolveAdminSetDrawer({ stored: 'closed', kiosk: true, wide: true }), 'closed');
  assert.equal(resolveAdminSetDrawer({ stored: 'open', kiosk: false, wide: false }), 'open');
  assert.equal(resolveAdminSetDrawer({ stored: null, kiosk: true, wide: false }), 'open');
  assert.equal(resolveAdminSetDrawer({ stored: null, kiosk: false, wide: true }), 'open');
  assert.equal(resolveAdminSetDrawer({ stored: null, kiosk: false, wide: false }), 'closed');
  assert.equal(normalizeAdminSetDrawer('open'), 'open');
  assert.equal(normalizeAdminSetDrawer('nope'), null);
  assert.equal(isWideAdminViewport({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(isWideAdminViewport({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(isWideAdminViewport(null), false);
});

test('stored admin set drawer round-trips', () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, value); },
  };
  assert.equal(readStoredAdminSetDrawer(storage), null);
  writeStoredAdminSetDrawer('open', storage);
  assert.equal(storage.getItem(ADMIN_SET_DRAWER_STORAGE_KEY), 'open');
  assert.equal(readStoredAdminSetDrawer(storage), 'open');
  writeStoredAdminSetDrawer('nope', storage);
  assert.equal(readStoredAdminSetDrawer(storage), 'open');
});

test('stored admin board mode round-trips', () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, value); },
  };
  assert.equal(readStoredAdminBoardMode(storage), null);
  writeStoredAdminBoardMode('dashboard', storage);
  assert.equal(storage.getItem(ADMIN_BOARD_STORAGE_KEY), 'dashboard');
  assert.equal(readStoredAdminBoardMode(storage), 'dashboard');
  writeStoredAdminBoardMode('nope', storage);
  assert.equal(readStoredAdminBoardMode(storage), 'dashboard');
});

test('collectOperatorViews skips system views and keeps config order', () => {
  const list = collectOperatorViews(exampleViews);
  assert.deepEqual(list.map((v) => v.id), ['band', 'visuals', 'lighting']);
  assert.equal(list[0].fields.length, 3);
});

test('dashboard zones dedupe colors and skip tempo', () => {
  assert.equal(dashboardFieldKind({ source: 'tempo' }), 'skip');
  assert.equal(dashboardFieldKind({ column: 'Key' }), 'token');
  assert.equal(dashboardFieldKind({ column: 'Key', type: 'camelot' }), 'camelot');
  assert.equal(dashboardFieldKind({ column: 'Lasers' }), 'note');
  assert.equal(dashboardFieldKind({ column: 'RGB_1', type: 'color' }), 'color');
  assert.equal(fieldIdentity({ column: 'RGB_1' }), 'column:RGB_1');
  assert.equal(fieldIdentity({ column: 'Key', type: 'camelot' }), 'column:Key:camelot');
  assert.equal(fieldIdentity({ source: 'tempo' }), 'source:tempo');

  const zones = buildDashboardZones(collectOperatorViews(exampleViews));
  assert.deepEqual(zones.tokens.map((f) => f.column), ['Key']);
  assert.deepEqual(zones.camelot.map((f) => f.label), ['Harmony']);
  assert.deepEqual(zones.images.map((f) => f.column), ['ART']);
  assert.deepEqual(zones.colors.map((f) => f.column), ['RGB_1', 'RGB_2', 'RGB_3']);
  assert.deepEqual(zones.noteGroups.map((g) => g.id), ['visuals', 'lighting']);
  assert.deepEqual(
    zones.noteGroups[0].fields.map((f) => f.column),
    ['Viz Notes', 'VIBE TAGS'],
  );
  assert.deepEqual(
    zones.noteGroups[1].fields.map((f) => f.column),
    ['Lasers', 'Lighting Notes', 'Automation'],
  );

  const flat = flattenOperatorFields(collectOperatorViews(exampleViews));
  assert.equal(flat.filter((f) => f.column === 'RGB_1').length, 1);
  assert.equal(flat.filter((f) => f.source === 'tempo').length, 1);
});

test('admin dashboard is wired in render, client, and session tracks', () => {
  const renderSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)),
    'utf8',
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  const sessionSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/session-render.js', import.meta.url)),
    'utf8',
  );
  const css = readFileSync(
    fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)),
    'utf8',
  );

  assert.match(renderSrc, /function renderAdminDashboard/);
  assert.match(renderSrc, /admin-dashboard-board/);
  assert.match(renderSrc, /Dashboard/);
  assert.match(renderSrc, /buildDashboardZones/);
  assert.match(renderSrc, /renderSessionTracks/);
  assert.match(renderSrc, /admin-dash-breath/);
  assert.match(renderSrc, /admin-set-drawer/);
  assert.match(renderSrc, /admin-dashboard-board--set-open/);
  assert.match(renderSrc, /<span>Set<\/span>/);
  assert.match(renderSrc, /onSetDrawerChange/);
  assert.match(clientSrc, /boardMode/);
  assert.match(clientSrc, /setBoardMode/);
  assert.match(clientSrc, /operatorViews/);
  assert.match(clientSrc, /layout-admin-dashboard/);
  assert.match(clientSrc, /adminDashboardFlash/);
  assert.match(clientSrc, /mountBreathPreview/);
  assert.match(clientSrc, /function dashboardCueChanged/);
  assert.match(clientSrc, /function updateAdminChrome/);
  assert.match(clientSrc, /noMatchHero: currentViewId === 'admin' && boardMode === 'dashboard'/);
  assert.match(clientSrc, /updateAdminChrome\(\{ refreshClipHead: false \}\)/);
  assert.match(clientSrc, /syncDashBreath/);
  assert.match(clientSrc, /setDrawerOpen/);
  assert.match(clientSrc, /setSetDrawer/);
  assert.match(clientSrc, /renderSetNav/);
  assert.match(clientSrc, /parkSessionLogMount/);
  assert.match(clientSrc, /sessionLogKeepMounted/);
  assert.match(clientSrc, /admin-set-log/);
  assert.match(clientSrc, /getWho: \(\) => currentViewId/);
  assert.match(clientSrc, /dashBreathCtl\?\.park/);
  assert.match(clientSrc, /dashBreathCtl\.attach/);
  assert.match(clientSrc, /t\.trackIndex/);
  const statusFn = clientSrc.match(/if \(msg\.type === 'status'[\s\S]*?\n    \}/);
  assert.ok(statusFn, 'status handler should exist');
  assert.match(statusFn[0], /updateAdminChrome\(\{ refreshClipHead: false \}\)/);
  assert.match(renderSrc, /refreshClipHead = true/);
  assert.match(renderSrc, /noMatchHero = false/);
  assert.match(sessionSrc, /session-tracks\.js/);
  assert.match(css, /body\.layout-admin-dashboard/);
  assert.match(css, /\.admin-dashboard-notes/);
  assert.match(css, /\.admin-dashboard-breath/);
  assert.match(css, /\.admin-dashboard-board--set-open/);
  assert.match(css, /\.admin-set-drawer/);
  assert.match(css, /\.set-nav-item--current/);
  assert.match(css, /\.admin-dashboard-breath-wave \{[\s\S]*?height: 7\.5rem;/);
  const dashFn = clientSrc.match(/function dashboardCueChanged\([\s\S]*?\n\}/);
  assert.ok(dashFn, 'dashboardCueChanged should exist');
  assert.doesNotMatch(dashFn[0], /isPlaying/);
});

test('breath preview helper is exported for the dashboard', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../public/shared/breath-render.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /export function mountBreathPreview/);
  assert.match(src, /export function drawBreathWave/);
  assert.match(src, /compact: true/);
  assert.match(src, /function park\(/);
  assert.match(src, /function attach\(/);
  assert.match(src, /waveLayerCache/);
});
