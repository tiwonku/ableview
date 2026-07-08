import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function testConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30, ...overrides.server },
    views: {
      band: {
        title: 'Band',
        fields: [
          { column: 'Key' },
          { column: 'BPM' },
          { column: 'Band Notes', label: 'Notes' },
        ],
      },
      ...overrides.views,
    },
    ...overrides,
  };
}

function openSocket(url) {
  const ws = new WebSocket(url);
  const messages = [];
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve({ ws, messages }));
    ws.once('error', reject);
  });
}

function waitForMessage(messages, ws, timeoutMs = 3000) {
  if (messages.length > 0) return Promise.resolve(messages.shift());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
    const onMessage = () => {
      if (messages.length === 0) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(messages.shift());
    };
    ws.on('message', onMessage);
  });
}

test('serves band view HTML', async () => {
  const bus = createBus();
  const server = await createViewServer({ config: testConfig(), bus, log: silentLog });

  const res = await fetch(`http://127.0.0.1:${server.port}/views/band`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /AbleView — Band/);
  assert.match(html, /connectView/);

  await server.stop();
});

test('serves visuals, lighting, and admin view HTML', async () => {
  const bus = createBus();
  const config = testConfig({
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      visuals: { title: 'Visuals', fields: [{ column: 'Mood' }] },
      lighting: { title: 'Lighting', fields: [{ column: 'Lighting Cue' }] },
      admin: { title: 'Admin', system: true },
    },
  });
  const server = await createViewServer({ config, bus, log: silentLog });

  for (const [name, title] of [
    ['visuals', 'Visuals'],
    ['lighting', 'Lighting'],
    ['admin', 'Admin'],
  ]) {
    const res = await fetch(`http://127.0.0.1:${server.port}/views/${name}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`AbleView — ${title}`));
    assert.match(html, /connectView/);
  }

  await server.stop();
});

test('WebSocket init includes view config and cue broadcast on bus emit', async () => {
  const bus = createBus();
  const server = await createViewServer({ config: testConfig(), bus, log: silentLog });

  const { ws, messages } = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=band`);

  const init = await waitForMessage(messages, ws);
  assert.equal(init.type, 'init');
  assert.equal(init.viewId, 'band');
  assert.equal(init.title, 'Band');
  assert.deepEqual(init.fields.map((f) => f.column), ['Key', 'BPM', 'Band Notes']);
  assert.equal(init.payload, null);

  const payload = makeCuePayload({
    clipName: 'Song A - Intro',
    match: makeMatchResult({ matched: true, confidence: 0.92, rowId: '5' }),
    row: { Key: 'A minor', BPM: '128', 'Band Notes': 'Count in 4' },
    syncedAt: '2026-07-07T20:12:00.000Z',
    stale: false,
    simulated: true,
  });
  bus.emit(EVENTS.CUE_PAYLOAD, payload);

  const cue = await waitForMessage(messages, ws);
  assert.equal(cue.type, 'cue');
  assert.equal(cue.payload.clipName, 'Song A - Intro');
  assert.equal(cue.payload.match.matched, true);
  assert.equal(cue.payload.simulated, true);

  ws.close();
  await server.stop();
});

test('WebSocket rejects unknown view id', async () => {
  const bus = createBus();
  const server = await createViewServer({ config: testConfig(), bus, log: silentLog });

  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?view=nonexistent`);
  const closed = new Promise((resolve) => ws.once('close', (code) => resolve(code)));
  const code = await closed;
  assert.equal(code, 1008);

  await server.stop();
});

test('CuePayload broadcast reaches client in under 200 ms', async () => {
  const bus = createBus();
  const server = await createViewServer({ config: testConfig(), bus, log: silentLog });

  const { ws, messages } = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=band`);
  await waitForMessage(messages, ws);

  const payload = makeCuePayload({
    clipName: 'Fast Clip',
    match: makeMatchResult({ matched: false, confidence: 0 }),
    syncedAt: null,
    stale: false,
    simulated: false,
  });

  const start = performance.now();
  bus.emit(EVENTS.CUE_PAYLOAD, payload);
  const msg = await waitForMessage(messages, ws);
  const elapsed = performance.now() - start;

  assert.equal(msg.type, 'cue');
  assert.equal(msg.payload.clipName, 'Fast Clip');
  assert.ok(elapsed < 200, `expected < 200 ms, got ${elapsed.toFixed(1)} ms`);

  ws.close();
  await server.stop();
});

test('admin WebSocket init includes system flag and status', async () => {
  const bus = createBus();
  const config = testConfig({
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  });
  const server = await createViewServer({ config, bus, log: silentLog });

  const { ws, messages } = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=admin`);

  const init = await waitForMessage(messages, ws);
  assert.equal(init.type, 'init');
  assert.equal(init.viewId, 'admin');
  assert.equal(init.system, true);
  assert.equal(typeof init.status?.connectedViews, 'number');

  ws.close();
  await server.stop();
});

test('admin receives status updates when operator views connect', async () => {
  const bus = createBus();
  const config = testConfig({
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  });
  const server = await createViewServer({ config, bus, log: silentLog });

  const admin = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=admin`);
  await waitForMessage(admin.messages, admin.ws);

  const band = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=band`);
  await waitForMessage(band.messages, band.ws);

  const status = await waitForMessage(admin.messages, admin.ws);
  assert.equal(status.type, 'status');
  assert.equal(status.status.connectedViews, 1);

  band.ws.close();
  const afterClose = await waitForMessage(admin.messages, admin.ws);
  assert.equal(afterClose.type, 'status');
  assert.equal(afterClose.status.connectedViews, 0);

  admin.ws.close();
  await server.stop();
});

test('role views receive configured field maps', async () => {
  const bus = createBus();
  const config = testConfig({
    views: {
      visuals: {
        title: 'Visuals',
        fields: [{ column: 'Mood' }, { column: 'Color' }],
      },
    },
  });
  const server = await createViewServer({ config, bus, log: silentLog });

  const { ws, messages } = await openSocket(`ws://127.0.0.1:${server.port}/ws?view=visuals`);
  const init = await waitForMessage(messages, ws);
  assert.equal(init.viewId, 'visuals');
  assert.deepEqual(init.fields.map((f) => f.column), ['Mood', 'Color']);

  ws.close();
  await server.stop();
});
