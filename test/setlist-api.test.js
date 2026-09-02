import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { createBus } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { createSetlistStore } from '../src/setlist/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const SHEET_ROWS = [
  { rowId: '5', data: { 'Song Title': 'Song A' } },
  { rowId: '7', data: { 'Song Title': 'Song B' } },
];

function testConfig(setlistDir) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 0 },
    setlist: {
      directory: setlistDir,
      defaultName: 'default',
    },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      setlist: { title: 'Set', system: true },
      admin: { title: 'Admin', system: true },
    },
  };
}

function collectWsMessages(ws) {
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  return messages;
}

function waitForMessage(messages, predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('timed out waiting for message'));
      }
      setTimeout(check, 20);
    };
    check();
  });
}

async function createTestServer(setlistDir) {
  const bus = createBus();
  const config = testConfig(setlistDir);
  const snapshot = {
    matchColumn: 'Song Title',
    rows: SHEET_ROWS,
  };
  const setlistStore = createSetlistStore({
    getConfig: () => config,
    getSnapshot: () => snapshot,
    bus,
    log: silentLog,
  });
  setlistStore.start();

  const server = await createViewServer({
    config,
    bus,
    log: silentLog,
    setlistStore,
    sheetsActions: {
      getSnapshot: () => snapshot,
      searchRows: () => [],
    },
  });

  return { server, setlistStore, setlistDir };
}

test('GET /views/setlist serves the setlist page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/views/setlist`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /AbleView — Set/);
    assert.match(html, /connectView/);
  } finally {
    await server.stop();
  }
});

test('GET /api/setlist returns the active list', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/setlist`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'default');
    assert.deepEqual(body.items, []);
  } finally {
    await server.stop();
  }
});

test('POST item, PATCH order/status, DELETE item', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  const base = `http://127.0.0.1:${server.port}`;
  try {
    const add = await fetch(`${base}/api/setlist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: '5' }),
    });
    assert.equal(add.status, 200);
    const added = await add.json();
    assert.equal(added.items.length, 1);
    assert.equal(added.items[0].title, 'Song A');

    const dup = await fetch(`${base}/api/setlist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: '5' }),
    });
    assert.equal(dup.status, 409);

    await fetch(`${base}/api/setlist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: '7', status: 'maybe' }),
    });

    const order = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['7', '5'] }),
    });
    assert.equal(order.status, 200);
    const ordered = await order.json();
    assert.deepEqual(ordered.items.map((i) => i.rowId), ['7', '5']);

    const status = await fetch(`${base}/api/setlist/items/7`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'likely' }),
    });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).items[0].status, 'likely');

    const remove = await fetch(`${base}/api/setlist/items/5`, { method: 'DELETE' });
    assert.equal(remove.status, 200);
    assert.equal((await remove.json()).items.length, 1);
  } finally {
    await server.stop();
  }
});

test('create, duplicate, and switch named setlists', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await fetch(`${base}/api/setlist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: '5' }),
    });

    const copy = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'festival-saturday', duplicate: true }),
    });
    assert.equal(copy.status, 200);
    assert.equal((await copy.json()).name, 'festival-saturday');

    const create = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'club-warmup', create: true }),
    });
    assert.equal(create.status, 200);
    const created = await create.json();
    assert.equal(created.name, 'club-warmup');
    assert.equal(created.items.length, 0);

    const switchTo = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'festival-saturday' }),
    });
    assert.equal(switchTo.status, 200);
    const switched = await switchTo.json();
    assert.equal(switched.name, 'festival-saturday');
    assert.equal(switched.items.length, 1);

    const missing = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'nope' }),
    });
    assert.equal(missing.status, 404);

    const sidecar = JSON.parse(readFileSync(join(dir, '.active.json'), 'utf8'));
    assert.equal(sidecar.setlistName, 'festival-saturday');
  } finally {
    await server.stop();
  }
});

test('DELETE /api/setlist and PATCH delete remove the current named set', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  const base = `http://127.0.0.1:${server.port}`;
  try {
    await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'festival-saturday', create: true }),
    });

    const gone = await fetch(`${base}/api/setlist`, { method: 'DELETE' });
    assert.equal(gone.status, 200);
    const deleted = await gone.json();
    assert.equal(deleted.ok, true);
    assert.equal(deleted.name, 'default');
    assert.equal(deleted.library.some((entry) => entry.name === 'festival-saturday'), false);

    await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'club-warmup', create: true }),
    });
    const patched = await fetch(`${base}/api/setlist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delete: true }),
    });
    assert.equal(patched.status, 200);
    const body = await patched.json();
    assert.equal(body.ok, true);
    assert.equal(body.name, 'default');
    assert.equal(body.library.some((entry) => entry.name === 'club-warmup'), false);
  } finally {
    await server.stop();
  }
});

test('WS init includes setlist and mutations broadcast', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-setlist-api-'));
  const { server } = await createTestServer(dir);
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?view=setlist`);
    const messages = collectWsMessages(ws);
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const initMsg = await waitForMessage(messages, (m) => m.type === 'init');
    assert.equal(initMsg.viewId, 'setlist');
    assert.equal(initMsg.setlist.name, 'default');

    const addedPromise = waitForMessage(
      messages,
      (m) => m.type === 'setlist' && m.setlist?.items?.length === 1,
    );

    const res = await fetch(`http://127.0.0.1:${server.port}/api/setlist/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowId: '5' }),
    });
    assert.equal(res.status, 200);

    const msg = await addedPromise;
    assert.equal(msg.setlist.items[0].rowId, '5');
  } finally {
    ws?.close();
    await server.stop();
  }
});

test('GET /api/setlist returns 501 when the store is missing', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(mkdtempSync(join(tmpdir(), 'ableview-setlist-none-'))),
    bus,
    log: silentLog,
  });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/setlist`);
    assert.equal(res.status, 501);
  } finally {
    await server.stop();
  }
});
