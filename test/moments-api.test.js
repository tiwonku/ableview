import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { createBus } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { createSessionLogger } from '../src/session-log/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function testConfig(sessionDir, momentsOverrides = {}) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30 },
    sessionLog: {
      directory: sessionDir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
    },
    moments: {
      autoStartOnMoment: true,
      kinds: ['dope'],
      debounceMs: 0,
      ...momentsOverrides,
    },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  };
}

async function createTestServer(sessionDir, momentsOverrides = {}) {
  const bus = createBus();
  const config = testConfig(sessionDir, momentsOverrides);
  const sessionLog = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
  });
  sessionLog.start();

  const server = await createViewServer({
    config,
    bus,
    log: silentLog,
    sessionLog,
  });

  return { server, bus, sessionLog, sessionDir, config };
}

async function stopTestServer({ server, sessionLog }) {
  await server.stop();
  sessionLog.stop();
}

function collectWsMessages(ws) {
  const messages = [];
  ws.on('message', (data) => {
    try {
      const raw = typeof data === 'string' ? data : data.toString();
      messages.push(JSON.parse(raw));
    } catch {
      // ignore
    }
  });
  return messages;
}

async function waitForMessage(messages, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = messages.find(predicate);
    if (hit) return hit;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('WS message timeout');
}

test('GET /api/moments returns disabled status by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir);

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/moments`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.sessionLogEnabled, false);
  assert.equal(body.lastMoment, null);
  assert.deepEqual(body.kinds, ['dope']);

  await stopTestServer(ctx);
});

test('POST /api/moments auto-starts logging with timestamp session name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir);

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'dope', who: 'keys' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.kind, 'dope');
  assert.equal(body.who, 'keys');
  assert.equal(body.sessionLogStarted, true);
  assert.match(body.sessionName, /^\d{4}-\d{2}-\d{2}_\d{6}$/);

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  const lines = readFileSync(join(dir, files[0]), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, 'moment');

  await stopTestServer(ctx);
});

test('POST /api/moments returns 409 when auto-start disabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir, { autoStartOnMoment: false });

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'dope' }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'session_log_disabled');

  await stopTestServer(ctx);
});

test('POST /api/moments returns 400 for unknown kind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir);
  await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'show' }),
  });

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'invalid' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error, 'unknown_kind');

  await stopTestServer(ctx);
});

test('WS client receives sessionLog on init and after moment auto-start', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir);

  const ws = new WebSocket(`ws://127.0.0.1:${ctx.server.port}/ws?view=band`);
  const messages = collectWsMessages(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const initMsg = await waitForMessage(messages, (m) => m.type === 'init');
  assert.equal(initMsg.sessionLog.enabled, false);

  const postPromise = waitForMessage(
    messages,
    (m) => m.type === 'sessionLog' && m.sessionLog?.enabled === true,
  );

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/moments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'dope' }),
  });
  assert.equal(res.status, 200);

  const sessionMsg = await postPromise;
  assert.equal(sessionMsg.sessionLog.enabled, true);
  assert.match(sessionMsg.sessionLog.sessionName, /^\d{4}-\d{2}-\d{2}_\d{6}$/);

  ws.close();
  await stopTestServer(ctx);
});

test('PATCH /api/session-log broadcasts sessionLog to WS clients', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-api-'));
  const ctx = await createTestServer(dir);

  const ws = new WebSocket(`ws://127.0.0.1:${ctx.server.port}/ws?view=band`);
  const messages = collectWsMessages(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await waitForMessage(messages, (m) => m.type === 'init');

  const patchPromise = waitForMessage(
    messages,
    (m) => m.type === 'sessionLog' && m.sessionLog?.sessionName === 'rehearsal',
  );

  const patch = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'rehearsal' }),
  });
  assert.equal(patch.status, 200);

  const msg = await patchPromise;
  assert.equal(msg.sessionLog.enabled, true);
  assert.equal(msg.sessionLog.sessionName, 'rehearsal');

  ws.close();
  await stopTestServer(ctx);
});
