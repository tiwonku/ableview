import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { buildHealthReport } from '../src/server/health.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function testConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30, ...overrides.server },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
      ...overrides.views,
    },
    ...overrides,
  };
}

function sheetSnapshot(overrides = {}) {
  return {
    syncedAt: '2026-07-08T12:00:00.000Z',
    stale: false,
    rows: [{ id: '1', 'Clip Name': 'Song A' }],
    ...overrides,
  };
}

test('buildHealthReport returns ok when sheet data is fresh', () => {
  const report = buildHealthReport({
    simulated: false,
    getSheetSnapshot: () => sheetSnapshot(),
    getConnectedViewCount: () => 2,
    lastCuePayload: makeCuePayload({
      clipName: 'Song A',
      match: makeMatchResult({ matched: true, confidence: 0.9 }),
    }),
  });

  assert.equal(report.status, 'ok');
  assert.equal(report.simulated, false);
  assert.equal(report.sheets.rowCount, 1);
  assert.equal(report.views.connected, 2);
  assert.equal(report.checks.length, 0);
});

test('buildHealthReport is degraded when sheet cache is stale', () => {
  const report = buildHealthReport({
    simulated: false,
    getSheetSnapshot: () => sheetSnapshot({ stale: true }),
    getConnectedViewCount: () => 0,
    lastCuePayload: makeCuePayload({ clipName: 'Song A' }),
  });

  assert.equal(report.status, 'degraded');
  assert.ok(report.checks.includes('sheet_stale'));
});

test('GET /health returns JSON and 503 when degraded', async () => {
  const bus = createBus();
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    getHealthContext: () => ({
      simulated: true,
      getSheetSnapshot: () => sheetSnapshot({ stale: true, rows: [] }),
    }),
  });

  const res = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.simulated, true);
  assert.ok(Array.isArray(body.checks));

  await server.stop();
});

test('GET /health returns 200 when healthy', async () => {
  const bus = createBus();
  const payload = makeCuePayload({
    clipName: 'Song A',
    match: makeMatchResult({ matched: true, confidence: 0.95 }),
  });

  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    getHealthContext: () => ({
      simulated: false,
      getSheetSnapshot: () => sheetSnapshot(),
    }),
  });

  bus.emit(EVENTS.CUE_PAYLOAD, payload);

  const res = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.cue.clipName, 'Song A');
  assert.equal(body.cue.matched, true);

  await server.stop();
});
