import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';
import { createShowCapture } from '../src/session-log/capture.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function line(seq, sessionName = 'cap-night', extra = {}) {
  return {
    seq,
    lineId: String(seq),
    sessionName,
    event: 'track_clip',
    clipName: `Clip ${seq}`,
    ...extra,
  };
}

function harness({ credentials, responder } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-capture-'));
  let clock = 0;
  const calls = [];
  let respond = responder ?? (async () => ({ status: 200 }));
  const capture = createShowCapture({
    getCredentials: () => credentials ?? ({
      url: 'https://show.test/api/show-capture',
      secret: 'tour-secret',
    }),
    log: silentLog,
    ackPath: join(dir, '.capture-ack.json'),
    intervalMs: 0,
    now: () => clock,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  });
  capture.start();
  return {
    dir,
    capture,
    calls,
    setClock(ms) { clock = ms; },
    advance(ms) { clock += ms; },
    setResponder(fn) { respond = fn; },
  };
}

async function sendNext(ctx) {
  await ctx.capture.flush();
  ctx.advance(1000);
}

test('capture stays off without a URL and secret', () => {
  const ctx = harness({ credentials: { url: '', secret: '' } });
  const result = ctx.capture.enable();
  assert.equal(result.ok, false);
  assert.match(result.error, /SHOW_CAPTURE_URL/);
  assert.equal(ctx.capture.getStatus().enabled, false);
  ctx.capture.enqueue(line(1));
  return ctx.capture.flush().then(() => {
    assert.equal(ctx.calls.length, 0);
  });
});

test('a batch is one session, with the bearer secret, and a retry repeats that body', async () => {
  const ctx = harness();
  assert.equal(ctx.capture.enable().ok, true);
  let attempts = 0;
  ctx.setResponder(async () => ({ status: attempts++ < 2 ? 503 : 200 }));
  ctx.capture.enqueue(line(1, 'cap-night'));
  ctx.capture.enqueue(line(1, 'other-night'));

  await ctx.capture.flush();
  ctx.setClock(2000);
  await ctx.capture.flush();
  ctx.setClock(2000 + 4000);
  await ctx.capture.flush();

  assert.equal(ctx.calls.length, 3);
  assert.equal(ctx.calls[0].init.headers.Authorization, 'Bearer tour-secret');
  assert.equal(ctx.calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(ctx.calls[0].init.body, ctx.calls[1].init.body);
  assert.equal(ctx.calls[1].init.body, ctx.calls[2].init.body);
  const body = JSON.parse(ctx.calls[0].init.body);
  assert.equal(body.lines.length, 1);
  assert.equal(body.lines[0].sessionName, 'cap-night');
  assert.equal(JSON.stringify(ctx.capture.getStatus()).includes('tour-secret'), false);

  ctx.advance(1000);
  await ctx.capture.flush();
  const second = JSON.parse(ctx.calls[3].init.body);
  assert.equal(second.lines[0].sessionName, 'other-night');
});

test('401 and 409 stop sending without inventing new line ids', async () => {
  const ctx = harness();
  ctx.capture.enable();
  ctx.setResponder(async () => ({ status: 401 }));
  ctx.capture.enqueue(line(1));
  await ctx.capture.flush();
  ctx.setClock(60_000);
  await ctx.capture.flush();
  assert.equal(ctx.calls.length, 1);
  assert.match(ctx.capture.getStatus().lastError, /secret/);

  ctx.capture.disable();
  ctx.capture.enable();
  ctx.setResponder(async (_url, init) => {
    const body = JSON.parse(init.body);
    return { status: body.lines[0].sessionName === 'cap-night' ? 409 : 200 };
  });
  ctx.capture.enqueue(line(1, 'cap-night'));
  ctx.capture.enqueue(line(1, 'other-night'));
  await sendNext(ctx);
  await sendNext(ctx);
  assert.equal(ctx.calls.length, 3);
  assert.equal(JSON.parse(ctx.calls[2].init.body).lines[0].sessionName, 'other-night');
  assert.match(ctx.capture.getStatus().lastError, /diverged/);
  await sendNext(ctx);
  assert.equal(ctx.calls.length, 3);
});

test('a rejected batch is dropped and later lines still send', async () => {
  const ctx = harness();
  ctx.capture.enable();
  ctx.setResponder(async (_url, init) => {
    const body = JSON.parse(init.body);
    return { status: body.lines[0].seq === 1 ? 400 : 200 };
  });
  ctx.capture.enqueue(line(1));
  await sendNext(ctx);
  ctx.capture.enqueue(line(2));
  await sendNext(ctx);
  assert.equal(ctx.calls.length, 2);
  assert.equal(JSON.parse(ctx.calls[1].init.body).lines[0].seq, 2);
  assert.match(ctx.capture.getStatus().lastError, /rejected a batch/);

  ctx.setClock(120_000);
  const restarted = createShowCapture({
    getCredentials: () => ({ url: 'https://show.test/api/show-capture', secret: 'tour-secret' }),
    log: silentLog,
    ackPath: join(ctx.dir, '.capture-ack.json'),
    intervalMs: 0,
    fetchImpl: async (url, init) => {
      ctx.calls.push({ url, init });
      return { status: 200 };
    },
  });
  const file = join(ctx.dir, 'cap-night.jsonl');
  writeFileSync(file, `${JSON.stringify(line(1))}\n${JSON.stringify(line(2))}\n`);
  restarted.start();
  restarted.enable();
  restarted.catchUp(file, 'cap-night');
  await restarted.flush();
  assert.equal(ctx.calls.length, 2);
});

test('requests stay under 30 a minute', async () => {
  const ctx = harness();
  ctx.capture.enable();
  for (let i = 0; i < 30; i += 1) ctx.capture.enqueue(line(1, `show-${i}`));
  for (let i = 0; i < 29; i += 1) await sendNext(ctx);
  assert.equal(ctx.calls.length, 29);
  await ctx.capture.flush();
  assert.equal(ctx.calls.length, 29);
  ctx.setClock(60_000);
  await ctx.capture.flush();
  assert.equal(ctx.calls.length, 30);
});

test('a line over 1 MB is parked and the next line still sends', async () => {
  const ctx = harness();
  ctx.capture.enable();
  ctx.capture.enqueue(line(1, 'cap-night', { blob: 'x'.repeat(1_000_000) }));
  ctx.capture.enqueue(line(2));
  await ctx.capture.flush();
  assert.equal(ctx.calls.length, 0);
  assert.match(ctx.capture.getStatus().lastError, /1 MB/);
  ctx.advance(1000);
  await ctx.capture.flush();
  assert.equal(JSON.parse(ctx.calls[0].init.body).lines[0].seq, 2);
});

test('the log line is on disk before any capture request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-capture-log-'));
  const calls = [];
  const capture = createShowCapture({
    getCredentials: () => ({ url: 'https://show.test/api/show-capture', secret: 'tour-secret' }),
    log: silentLog,
    ackPath: join(dir, '.capture-ack.json'),
    intervalMs: 0,
    fetchImpl: async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { status: 200 };
    },
  });
  const config = {
    ...DEFAULTS,
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
    },
    sim: { ...DEFAULTS.sim, enabled: false },
  };
  const bus = createBus();
  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
    capture,
  });
  logger.start();

  writeFileSync(join(dir, 'cap-night.jsonl'), `${JSON.stringify({
    event: 'match',
    sessionName: 'cap-night',
    clipName: 'already on disk',
  })}\n`);

  logger.applyPatch({ enabled: true, sessionName: 'cap-night', captureEnabled: true });
  bus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song A',
    match: makeMatchResult({ matched: false, confidence: 0 }),
    syncedAt: null,
    stale: false,
  }));

  assert.equal(calls.length, 0);
  const { readFileSync } = await import('node:fs');
  const stored = readFileSync(join(dir, 'cap-night.jsonl'), 'utf8').trim().split('\n').map((row) => JSON.parse(row));
  assert.equal(stored[0].seq, undefined);
  assert.equal(stored[1].seq, 2);
  assert.equal(stored[1].lineId, '2');
  assert.equal(JSON.stringify(logger.getStatus()).includes('tour-secret'), false);

  await capture.flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lines.length, 1);
  assert.equal(calls[0].lines[0].lineId, '2');
  assert.equal(calls[0].lines[0].seq, 2);

  logger.stop();
});
