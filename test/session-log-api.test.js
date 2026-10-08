import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { createSessionLogger } from '../src/session-log/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function testConfig(sessionDir) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30 },
    sessionLog: {
      directory: sessionDir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
    },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  };
}

async function createTestServer(sessionDir, { capture } = {}) {
  const bus = createBus();
  const config = testConfig(sessionDir);
  const sessionLog = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
    capture,
  });
  sessionLog.start();

  const server = await createViewServer({
    config,
    bus,
    log: silentLog,
    sessionLog,
  });

  return { server, bus, sessionLog, sessionDir };
}

async function stopTestServer({ server, sessionLog }) {
  await server.stop();
  sessionLog.stop();
}

test('GET /api/session-log returns disabled status by default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-api-'));
  const ctx = await createTestServer(dir);

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.enabled, false);
  assert.equal(body.lineCount, 0);

  await stopTestServer(ctx);
});

test('PATCH enable and sessionName append on cue payload', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-api-'));
  const ctx = await createTestServer(dir);

  const enable = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'rehearsal' }),
  });
  assert.equal(enable.status, 200);
  const enabledBody = await enable.json();
  assert.equal(enabledBody.enabled, true);
  assert.equal(enabledBody.sessionName, 'rehearsal');

  ctx.bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'Song A',
      match: makeMatchResult({ matched: true, confidence: 1, rowId: '1', matchedValue: 'Song A' }),
      syncedAt: '2026-07-07T20:00:00.000Z',
      stale: false,
    })
  );

  const file = join(dir, 'rehearsal.jsonl');
  assert.ok(existsSync(file));
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).event, 'match');

  await stopTestServer(ctx);
});

test('PATCH invalid session name returns 400', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-api-'));
  const ctx = await createTestServer(dir);

  const res = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionName: '../evil' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);

  await stopTestServer(ctx);
});

test('PATCH sessionName rotates to new file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-api-'));
  const ctx = await createTestServer(dir);

  await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'segment-a' }),
  });

  ctx.bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'A',
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt: null,
      stale: false,
    })
  );

  const rotate = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionName: 'segment-b' }),
  });
  assert.equal(rotate.status, 200);
  const rotated = await rotate.json();
  assert.equal(rotated.sessionName, 'segment-b');
  assert.equal(rotated.lineCount, 0);

  ctx.bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'B',
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt: null,
      stale: false,
    })
  );

  assert.ok(existsSync(join(dir, 'segment-a.jsonl')));
  assert.ok(existsSync(join(dir, 'segment-b.jsonl')));

  await stopTestServer(ctx);
});

test('PATCH captureEnabled requires website credentials and hides the secret', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-api-'));
  const missing = await createTestServer(dir);
  const denied = await fetch(`http://127.0.0.1:${missing.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureEnabled: true }),
  });
  assert.equal(denied.status, 400);
  const deniedBody = await denied.json();
  assert.match(deniedBody.error, /SHOW_CAPTURE_URL/);
  await stopTestServer(missing);

  const { createShowCapture } = await import('../src/session-log/capture.js');
  const capture = createShowCapture({
    getCredentials: () => ({ url: 'https://show.test/api/show-capture', secret: 'tour-secret' }),
    log: silentLog,
    ackPath: join(dir, '.capture-ack.json'),
    intervalMs: 0,
    fetchImpl: async () => {
      throw new Error('capture fetch ran during the settings toggle');
    },
  });
  const ctx = await createTestServer(dir, { capture });
  const enabled = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureEnabled: true }),
  });
  assert.equal(enabled.status, 200);
  const body = await enabled.json();
  assert.equal(body.capture.enabled, true);
  assert.equal(body.capture.configured, true);
  assert.equal(JSON.stringify(body).includes('tour-secret'), false);

  const off = await fetch(`http://127.0.0.1:${ctx.server.port}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captureEnabled: false }),
  });
  assert.equal(off.status, 200);
  const offBody = await off.json();
  assert.equal(offBody.capture.enabled, false);

  await stopTestServer(ctx);
});
