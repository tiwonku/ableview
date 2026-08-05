import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { createAbletonOscSource } from '../src/ingest/sources/abletonosc.js';
import { createOscEmitter } from '../src/sim/osc-emitter.js';
import { createMatcher } from '../src/match/index.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { DEFAULTS } from '../src/config/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function oscTestConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    sim: {
      ...DEFAULTS.sim,
      enabled: true,
      mode: 'osc',
      driver: 'scenario',
      scenario: './test/fixtures/fired-quant-scenario.json',
      intervalSeconds: 30,
      quantDelaySeconds: 0.1,
    },
    ingest: {
      ...DEFAULTS.ingest,
      oscListenPort: 13201,
      oscSendPort: 13200,
      abletonHost: '127.0.0.1',
      staleAfterMs: 5000,
      pollIntervalMs: 2000,
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
      ...overrides.ingest,
    },
    sheets: {
      ...DEFAULTS.sheets,
      matchColumn: 'Clip Name',
      aliasColumn: 'Aliases',
    },
    ...overrides,
  };
}

test('abletonosc starts offline until AbletonOSC replies', async () => {
  const bus = createBus();
  const config = oscTestConfig();
  const adapter = createAbletonOscSource({ config, bus, log: silentLog });

  await adapter.start();
  try {
    assert.equal(adapter.getIngestStatus().live, false);

    const livePromise = new Promise((resolve) => {
      const handler = (status) => {
        if (status.live) {
          bus.off(EVENTS.INGEST_STATUS, handler);
          resolve();
        }
      };
      bus.on(EVENTS.INGEST_STATUS, handler);
    });

    const emitter = createOscEmitter({ config, log: silentLog });
    await emitter.start();
    try {
      await Promise.race([livePromise, wait(3000)]);
      assert.equal(adapter.getIngestStatus().live, true);
    } finally {
      emitter.stop();
    }
  } finally {
    adapter.stop();
  }
});

test('abletonosc marks ingest stale after silence and recovers on traffic', async () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });

  const bus = createBus();
  const statuses = [];
  bus.on(EVENTS.INGEST_STATUS, (status) => statuses.push({ ...status }));

  const config = oscTestConfig();
  const emitter = createOscEmitter({ config, log: silentLog });
  const adapter = createAbletonOscSource({ config, bus, log: silentLog });

  await emitter.start();
  await adapter.start();

  try {
    await wait(80);
    assert.equal(adapter.getIngestStatus().live, true);

    emitter.stop();
    mock.timers.setTime(Date.now() + 6000);
    mock.timers.tick(2000);
    assert.equal(adapter.getIngestStatus().live, false);

    await emitter.start();
    await wait(80);
    assert.equal(adapter.getIngestStatus().live, true);
    assert.ok(statuses.some((s) => s.live === false));
    assert.ok(statuses.at(-1).live);
  } finally {
    adapter.stop();
    emitter.stop();
    mock.timers.reset();
  }
});

test('matcher rebroadcasts ingestLive without changing clip', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (payload) => payloads.push(payload));

  const config = oscTestConfig();
  const snapshot = {
    syncedAt: '2026-07-08T12:00:00.000Z',
    stale: false,
    rows: [{ rowId: 1, data: { 'Clip Name': 'Song A' } }],
  };

  createMatcher({
    config,
    bus,
    log: silentLog,
    getSnapshot: () => snapshot,
  });

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    authoritativeClip: 'Song A',
    tracks: [{ trackIndex: 0, trackName: 'Cue', clipName: 'Song A', slotIndex: 0 }],
  }));

  assert.equal(payloads.at(-1).clipName, 'Song A');
  assert.equal(payloads.at(-1).ingestLive, true);

  bus.emit(EVENTS.INGEST_STATUS, { live: false, lastSeenAt: null });

  assert.equal(payloads.length, 2);
  assert.equal(payloads.at(-1).clipName, 'Song A');
  assert.equal(payloads.at(-1).ingestLive, false);
});
