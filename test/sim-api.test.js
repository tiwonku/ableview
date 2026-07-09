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

function simActions(overrides = {}) {
  let available = true;
  let canControl = true;
  let lastFired = null;
  let paused = false;
  let stepIndex = 1;

  const base = {
    isAvailable: () => available,
    canControl: () => canControl,
    fire: (clipName, opts) => {
      lastFired = { clipName, opts };
      paused = true;
      return { authoritativeClip: clipName, tempo: opts?.tempo ?? null };
    },
    clear: () => {
      lastFired = { clipName: null };
      paused = true;
      return { authoritativeClip: null };
    },
    getStatus: () => ({
      paused,
      driver: 'scenario',
      stepIndex,
      clipNames: ['Song A - Intro', 'Song A - Drop'],
      canAutoAdvance: true,
    }),
    pause: () => {
      paused = true;
      return base.getStatus();
    },
    resume: () => {
      paused = false;
      return base.getStatus();
    },
    step: (direction) => {
      paused = true;
      const clipName = direction === 'next' ? 'Song A - Drop' : 'Song A - Intro';
      lastFired = { clipName, direction };
      if (direction === 'next') stepIndex += 1;
      return { authoritativeClip: clipName };
    },
    getLastFired() {
      return lastFired;
    },
    setAvailable(v) {
      available = v;
    },
    setCanControl(v) {
      canControl = v;
    },
  };

  return { ...base, ...overrides };
}

test('POST /api/sim/fire returns 400 when simulation is off', async () => {
  const actions = simActions();
  actions.setAvailable(false);

  const server = await createViewServer({
    config: testConfig(),
    bus: createBus(),
    log: silentLog,
    simActions: actions,
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sim/fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipName: 'Test Clip' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /simulation mode/i);

  await server.stop();
});

test('POST /api/sim/fire returns 400 when sim.mode is osc', async () => {
  const actions = simActions();
  actions.setCanControl(false);

  const server = await createViewServer({
    config: testConfig(),
    bus: createBus(),
    log: silentLog,
    simActions: actions,
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/sim/fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipName: 'Test Clip' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /internal/i);

  await server.stop();
});

test('POST /api/sim/fire fires clip and POST /api/sim/clear clears', async () => {
  const actions = simActions();

  const server = await createViewServer({
    config: testConfig(),
    bus: createBus(),
    log: silentLog,
    simActions: actions,
  });

  const fireRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/fire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipName: 'Song A - Intro', tempo: 128 }),
  });
  assert.equal(fireRes.status, 200);
  const fireBody = await fireRes.json();
  assert.equal(fireBody.ok, true);
  assert.equal(fireBody.authoritativeClip, 'Song A - Intro');
  assert.equal(fireBody.status.paused, true);
  assert.equal(actions.getLastFired().clipName, 'Song A - Intro');
  assert.equal(actions.getLastFired().opts.tempo, 128);

  const clearRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/clear`, { method: 'POST' });
  assert.equal(clearRes.status, 200);
  const clearBody = await clearRes.json();
  assert.equal(clearBody.ok, true);
  assert.equal(clearBody.authoritativeClip, null);
  assert.equal(actions.getLastFired().clipName, null);

  await server.stop();
});

test('GET /api/sim/status and transport endpoints', async () => {
  const actions = simActions();

  const server = await createViewServer({
    config: testConfig(),
    bus: createBus(),
    log: silentLog,
    simActions: actions,
  });

  const statusRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/status`);
  assert.equal(statusRes.status, 200);
  const statusBody = await statusRes.json();
  assert.equal(statusBody.canAutoAdvance, true);
  assert.deepEqual(statusBody.clipNames, ['Song A - Intro', 'Song A - Drop']);

  const pauseRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/pause`, { method: 'POST' });
  assert.equal(pauseRes.status, 200);
  assert.equal((await pauseRes.json()).status.paused, true);

  const resumeRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/resume`, { method: 'POST' });
  assert.equal(resumeRes.status, 200);
  assert.equal((await resumeRes.json()).status.paused, false);

  const nextRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'next' }),
  });
  assert.equal(nextRes.status, 200);
  const nextBody = await nextRes.json();
  assert.equal(nextBody.authoritativeClip, 'Song A - Drop');

  const prevRes = await fetch(`http://127.0.0.1:${server.port}/api/sim/step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction: 'prev' }),
  });
  assert.equal(prevRes.status, 200);
  assert.equal((await prevRes.json()).authoritativeClip, 'Song A - Intro');

  await server.stop();
});

test('admin view includes sim controls at top of page', async () => {
  const server = await createViewServer({
    config: testConfig(),
    bus: createBus(),
    log: silentLog,
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/views/admin`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /mountSimControls/);
  assert.match(html, /id="sim-controls-host"[\s\S]*id="app"/);

  await server.stop();
});
