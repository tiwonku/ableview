import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { createSessionLogger } from '../src/session-log/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

async function createTestServer(sessionDir) {
  const bus = createBus();
  const config = {
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
    },
  };
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
  return { server, sessionLog, bus };
}

test('GET /api/sessions lists logs and skips normalized copies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-sets-'));
  writeFileSync(join(dir, 'YD_N1.jsonl'), `${JSON.stringify({
    timestamp: '19:49:57:00',
    loggedAt: '2026-09-19T01:49:57.000Z',
    event: 'match',
    clipName: 'TTT',
    match: { matched: true, matchedValue: 'TTT' },
    pendingLaunch: false,
    row: { 'Song Title': 'Trip Thru Time' },
  })}\n${JSON.stringify({
    timestamp: '19:55:37:00',
    loggedAt: '2026-09-19T01:55:37.000Z',
    event: 'moment',
    kind: 'dope',
    who: 'Derek',
    note: null,
  })}\n`);
  writeFileSync(join(dir, 'YD_N1.normalized.jsonl'), '{}\n');
  writeFileSync(join(dir, '.hidden.jsonl'), '{}\n');

  const ctx = await createTestServer(dir);
  const listRes = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.deepEqual(list.sessions.map((row) => row.name), ['YD_N1']);
  assert.equal(list.sessions[0].songCount, 1);
  assert.equal(list.sessions[0].dopeCount, 1);

  const oneRes = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/YD_N1`);
  assert.equal(oneRes.status, 200);
  const one = await oneRes.json();
  assert.equal(one.songs[0].title, 'Trip Thru Time');
  assert.equal(one.moments[0].who, 'Derek');

  const edlRes = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/YD_N1/edl?notes=0`);
  assert.equal(edlRes.status, 200);
  assert.match(edlRes.headers.get('content-type'), /text\/plain/);
  assert.match(edlRes.headers.get('content-disposition'), /YD_N1-markers\.edl/);
  const text = await edlRes.text();
  assert.match(text, /\|M:Trip Thru Time \|D:1/);
  assert.match(text, /\|M:Derek \|D:1/);

  const forced = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/YD_N1/edl?rate=29.97&dropFrame=1`);
  assert.equal(forced.status, 200);
  const forcedText = await forced.text();
  assert.match(forcedText, /FCM: NON-DROP FRAME/);
  assert.match(forcedText, /\|M:Derek \|D:1/);

  const missing = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/nope`);
  assert.equal(missing.status, 404);
  const bad = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/bad%20name`);
  assert.equal(bad.status, 400);

  const page = await fetch(`http://127.0.0.1:${ctx.server.port}/views/sets`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Logged sets/);

  const missingDelete = await fetch(`http://127.0.0.1:${ctx.server.port}/api/sessions/nope`, {
    method: 'DELETE',
  });
  assert.equal(missingDelete.status, 404);

  await ctx.server.stop();
  ctx.sessionLog.stop();
});

test('DELETE /api/sessions removes the file and stops logging that name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-sets-delete-'));
  writeFileSync(join(dir, 'keep.jsonl'), `${JSON.stringify({
    timestamp: '18:00:00:00',
    loggedAt: '2026-09-18T23:00:00.000Z',
    event: 'moment',
    kind: 'dope',
    who: 'Phil',
    note: null,
  })}\n`);
  const ctx = await createTestServer(dir);
  const base = `http://127.0.0.1:${ctx.server.port}`;

  const enable = await fetch(`${base}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'YD_N1' }),
  });
  assert.equal(enable.status, 200);

  const cue = makeCuePayload({
    clipName: 'Wake Up',
    match: makeMatchResult({ matched: true, confidence: 1, rowId: '1', matchedValue: 'Wake Up' }),
    syncedAt: '2026-09-19T02:10:00.000Z',
    stale: false,
  });
  ctx.bus.emit(EVENTS.CUE_PAYLOAD, cue);
  const file = join(dir, 'YD_N1.jsonl');
  assert.equal(existsSync(file), true);

  const deleted = await fetch(`${base}/api/sessions/YD_N1`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true, name: 'YD_N1' });
  assert.equal(existsSync(file), false);

  const status = await fetch(`${base}/api/session-log`);
  const body = await status.json();
  assert.equal(body.enabled, false);

  ctx.bus.emit(EVENTS.CUE_PAYLOAD, cue);
  assert.equal(existsSync(file), false);

  const again = await fetch(`${base}/api/session-log`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true, sessionName: 'YD_N1' }),
  });
  assert.equal(again.status, 200);
  ctx.bus.emit(EVENTS.CUE_PAYLOAD, cue);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);

  const list = await fetch(`${base}/api/sessions`);
  const names = (await list.json()).sessions.map((row) => row.name).sort();
  assert.deepEqual(names, ['YD_N1', 'keep']);

  await ctx.server.stop();
  ctx.sessionLog.stop();
});
