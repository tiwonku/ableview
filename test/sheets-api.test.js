import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function testConfig() {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30 },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  };
}

test('GET /api/sheets/status returns snapshot metadata', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      getSnapshot: () => ({
        syncedAt: '2026-07-08T12:00:00.000Z',
        stale: false,
        rows: [{ rowId: '1', data: {} }, { rowId: '2', data: {} }],
        worksheet: 'Cues',
      }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.rowCount, 2);
  assert.equal(body.stale, false);
  assert.equal(body.worksheet, 'Cues');

  await server.stop();
});

test('POST /api/sheets/sync returns ok and calls onSynced', async () => {
  const bus = createBus();
  let synced = false;
  let rematched = false;

  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => { synced = true; },
      getSnapshot: () => ({
        syncedAt: '2026-07-08T12:05:00.000Z',
        stale: false,
        rows: [{ rowId: '1', data: {} }],
        worksheet: 'Cues',
      }),
      onSynced: () => { rematched = true; },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/sync`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.rowCount, 1);
  assert.equal(synced, true);
  assert.equal(rematched, true);

  await server.stop();
});

test('POST /api/sheets/sync returns 502 on failure', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => { throw new Error('network down'); },
      getSnapshot: () => ({
        syncedAt: '2026-07-07T10:00:00.000Z',
        stale: true,
        rows: [],
        worksheet: 'Cues',
      }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/sync`, { method: 'POST' });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /network down/);
  assert.equal(body.stale, true);

  await server.stop();
});

test('POST /api/sheets/rows appends row and rematches', async () => {
  const bus = createBus();
  let appended = null;
  let rematched = false;
  const rows = [{ rowId: '12', data: { 'Song Title': 'Existing', BPM: '95' } }];

  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      appendRow: async (changes) => {
        appended = changes;
        const row = { 'Song Title': 'New Song', BPM: '120' };
        rows.push({ rowId: '13', data: row });
        return { rowId: '13', row };
      },
      getSnapshot: () => ({
        syncedAt: '2026-07-09T12:00:00.000Z',
        stale: false,
        rows,
        worksheet: 'Cues',
        headers: ['Song Title', 'BPM'],
      }),
      onSynced: () => { rematched = true; },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 'Song Title': 'New Song', BPM: '120' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.rowId, '13');
  assert.equal(body.row['Song Title'], 'New Song');
  assert.deepEqual(appended, { 'Song Title': 'New Song', BPM: '120' });
  assert.equal(rematched, true);

  await server.stop();
});

test('POST /api/sheets/rows returns 400 for invalid body', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      appendRow: async () => {},
      getSnapshot: () => ({ syncedAt: null, stale: true, rows: [], worksheet: 'Cues' }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['not', 'an', 'object']),
  });
  assert.equal(res.status, 400);

  await server.stop();
});

test('POST /api/sheets/rows returns 400 when appendRow rejects', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      appendRow: async () => { throw new Error('Song Title is required'); },
      getSnapshot: () => ({ syncedAt: null, stale: true, rows: [], worksheet: 'Cues' }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ BPM: '120' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /Song Title is required/);

  await server.stop();
});

test('PATCH /api/sheets/rows/:rowId updates row and rematches', async () => {
  const bus = createBus();
  let updated = null;
  let rematched = false;
  const rows = [{ rowId: '12', data: { BPM: '95', Cue: '✖' } }];

  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      updateRow: async (rowId, changes) => {
        updated = { rowId, changes };
        rows[0].data = { ...rows[0].data, BPM: '105' };
      },
      getSnapshot: () => ({
        syncedAt: '2026-07-09T12:00:00.000Z',
        stale: false,
        rows,
        worksheet: 'Cues',
        headers: ['BPM', 'Cue'],
      }),
      onSynced: () => { rematched = true; },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows/12`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ BPM: '105' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.rowId, '12');
  assert.equal(body.row.BPM, '105');
  assert.deepEqual(updated, { rowId: '12', changes: { BPM: '105' } });
  assert.equal(rematched, true);

  await server.stop();
});

test('PATCH /api/sheets/rows/:rowId returns 400 for invalid body', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      updateRow: async () => {},
      getSnapshot: () => ({ syncedAt: null, stale: true, rows: [], worksheet: 'Cues' }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows/12`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(['not', 'an', 'object']),
  });
  assert.equal(res.status, 400);

  await server.stop();
});

test('PATCH /api/sheets/rows/:rowId returns 400 when updateRow rejects', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      updateRow: async () => { throw new Error('row not found: 99'); },
      getSnapshot: () => ({ syncedAt: null, stale: true, rows: [], worksheet: 'Cues' }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows/99`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ BPM: '100' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /row not found/);

  await server.stop();
});

test('GET /api/sheets/rows/search returns ranked results', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      getSnapshot: () => ({
        syncedAt: '2026-07-09T12:00:00.000Z',
        stale: false,
        rows: [],
        worksheet: 'Cues',
        headers: ['Song Title', 'Aliases', 'ALS Folder'],
        matchColumn: 'Song Title',
        aliasColumn: 'Aliases',
      }),
      searchRows: (query) => {
        assert.equal(query, 'HotRox');
        return [
          {
            rowId: '70',
            title: 'Hot Like Rox',
            aliases: '',
            secondary: [{ column: 'ALS Folder', value: 'Ebm_80bpm_HotRox_24' }],
          },
        ];
      },
    },
  });

  const res = await fetch(
    `http://127.0.0.1:${server.port}/api/sheets/rows/search?q=${encodeURIComponent('HotRox')}`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.aliasColumnPresent, true);
  assert.equal(body.results[0].title, 'Hot Like Rox');

  await server.stop();
});

test('POST /api/sheets/rows/:rowId/aliases appends and rematches', async () => {
  const bus = createBus();
  let rematched = false;
  let appended = null;

  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      appendAlias: async (rowId, alias) => {
        appended = { rowId, alias };
        return {
          rowId: String(rowId),
          row: { 'Song Title': 'Hot Like Rox', Aliases: alias },
          alias,
          aliases: [alias],
          added: true,
        };
      },
      getSnapshot: () => ({
        syncedAt: '2026-07-09T12:00:00.000Z',
        stale: false,
        rows: [{ rowId: '70', data: { 'Song Title': 'Hot Like Rox', Aliases: 'HotRox' } }],
        worksheet: 'Cues',
        headers: ['Song Title', 'Aliases'],
        aliasColumn: 'Aliases',
      }),
      onSynced: () => {
        rematched = true;
      },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows/70/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias: 'HotRox' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.added, true);
  assert.deepEqual(appended, { rowId: '70', alias: 'HotRox' });
  assert.equal(rematched, true);

  await server.stop();
});

test('POST /api/sheets/rows/:rowId/aliases returns 400 when column missing', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    sheetsActions: {
      sync: async () => {},
      appendAlias: async () => {
        throw new Error(
          'Aliases column "Aliases" not found on the sheet. Add that header, sync, then try again.'
        );
      },
      getSnapshot: () => ({
        syncedAt: null,
        stale: true,
        rows: [],
        worksheet: 'Cues',
        headers: ['Song Title'],
        aliasColumn: 'Aliases',
      }),
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sheets/rows/70/aliases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alias: 'HotRox' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Aliases column/);

  await server.stop();
});
