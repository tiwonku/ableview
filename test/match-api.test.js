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

test('POST /api/match/override pins a row', async () => {
  const bus = createBus();
  let setId = null;
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    matchActions: {
      setOverride(rowId) {
        setId = String(rowId);
        return { rowId: setId, applied: true, queued: false };
      },
      clearOverride() {
        setId = null;
        return { rowId: null, applied: false, queued: false };
      },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/match/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId: '5' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.applied, true);
  assert.equal(body.rowId, '5');
  assert.equal(setId, '5');

  await server.stop();
});

test('POST /api/match/override rejects a missing rowId', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    matchActions: {
      setOverride() { return { rowId: '5', applied: true, queued: false }; },
      clearOverride() { return { rowId: null, applied: false, queued: false }; },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/match/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);

  await server.stop();
});

test('DELETE /api/match/override clears the pin', async () => {
  const bus = createBus();
  let cleared = false;
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    matchActions: {
      setOverride() { return { rowId: '5', applied: true, queued: false }; },
      clearOverride() {
        cleared = true;
        return { rowId: null, applied: false, queued: false };
      },
    },
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/match/override`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(cleared, true);

  await server.stop();
});

test('POST /api/match/override returns 501 when setOverride is missing', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    matchActions: {},
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/api/match/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId: '5' }),
  });
  assert.equal(res.status, 501);

  await server.stop();
});
