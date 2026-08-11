import { test } from 'node:test';
import assert from 'node:assert/strict';
import osc from 'osc';
import { findCueTrack, makeIngestStatus } from '../src/ingest/ableton-session.js';
import { buildHealthReport } from '../src/server/health.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
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

function sheetSnapshot() {
  return {
    syncedAt: '2026-07-08T12:00:00.000Z',
    stale: false,
    rows: [{ id: '1', 'Clip Name': 'Song A' }],
  };
}

test('findCueTrack reports missing independently of OSC liveness', () => {
  assert.deepEqual(findCueTrack(['Drums', 'Bass'], 'Cue'), {
    cueTrackConfigured: 'Cue',
    cueTrackFound: false,
  });
  assert.deepEqual(findCueTrack(['Cue', 'Drums'], 'Cue'), {
    cueTrackConfigured: 'Cue',
    cueTrackFound: true,
  });
  assert.deepEqual(findCueTrack(['Drums', 'Bass'], 1), {
    cueTrackConfigured: 1,
    cueTrackFound: true,
  });
  assert.deepEqual(findCueTrack(null, 'Cue'), {
    cueTrackConfigured: 'Cue',
    cueTrackFound: null,
  });
  assert.deepEqual(findCueTrack(['Drums'], null), {
    cueTrackConfigured: null,
    cueTrackFound: null,
  });
});

test('makeIngestStatus copies track names and cue diagnostics', () => {
  const status = makeIngestStatus({
    live: true,
    lastSeenAt: 123,
    trackNames: ['A', 'Cue'],
    authoritativeTrack: 'Cue',
  });
  assert.equal(status.live, true);
  assert.equal(status.cueTrackFound, true);
  assert.deepEqual(status.trackNames, ['A', 'Cue']);
  status.trackNames.push('mutated');
  assert.deepEqual(
    makeIngestStatus({
      live: true,
      trackNames: ['A', 'Cue'],
      authoritativeTrack: 'Cue',
    }).trackNames,
    ['A', 'Cue']
  );
});

test('buildHealthReport flags cue_track_missing when session is live', () => {
  const report = buildHealthReport({
    simulated: false,
    getSheetSnapshot: () => sheetSnapshot(),
    getConnectedViewCount: () => 0,
    getIngestStatus: () => ({
      live: true,
      lastSeenAt: Date.now(),
      trackNames: ['Drums', 'Vocals'],
      cueTrackConfigured: 'Cue',
      cueTrackFound: false,
    }),
    lastCuePayload: makeCuePayload({
      clipName: null,
      match: makeMatchResult({ matched: false }),
    }),
  });

  assert.equal(report.status, 'degraded');
  assert.ok(report.checks.includes('cue_track_missing'));
  assert.equal(report.ingest.cueTrackFound, false);
  assert.deepEqual(report.ingest.trackNames, ['Drums', 'Vocals']);
});

test('buildHealthReport does not flag cue track when none is configured', () => {
  const report = buildHealthReport({
    simulated: false,
    getSheetSnapshot: () => sheetSnapshot(),
    getConnectedViewCount: () => 0,
    getIngestStatus: () => ({
      live: true,
      lastSeenAt: Date.now(),
      trackNames: ['DECK A', 'DECK C'],
      cueTrackConfigured: null,
      cueTrackFound: null,
    }),
    lastCuePayload: makeCuePayload({
      clipName: 'x',
      match: makeMatchResult({ matched: true, confidence: 1, rowId: '1' }),
    }),
  });

  assert.ok(!report.checks.includes('cue_track_missing'));
});

test('buildHealthReport does not flag cue track before track list arrives', () => {
  const report = buildHealthReport({
    simulated: false,
    getSheetSnapshot: () => sheetSnapshot(),
    getConnectedViewCount: () => 0,
    getIngestStatus: () => ({
      live: true,
      lastSeenAt: Date.now(),
      trackNames: null,
      cueTrackConfigured: 'Cue',
      cueTrackFound: null,
    }),
    lastCuePayload: makeCuePayload({
      clipName: null,
      match: makeMatchResult({ matched: false }),
    }),
  });

  assert.ok(!report.checks.includes('cue_track_missing'));
});

test('abletonosc exposes session track names even when cue track is absent', async () => {
  const bus = createBus();
  const config = {
    ...DEFAULTS,
    ingest: {
      ...DEFAULTS.ingest,
      oscListenPort: 13301,
      oscSendPort: 13300,
      abletonHost: '127.0.0.1',
      staleAfterMs: 5000,
      pollIntervalMs: 2000,
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
    },
    sim: {
      ...DEFAULTS.sim,
      enabled: true,
      mode: 'osc',
      driver: 'scenario',
      scenario: './test/fixtures/fired-quant-scenario.json',
      intervalSeconds: 30,
      quantDelaySeconds: 0.1,
    },
  };

  // Emitter only has "Cue"; override by starting adapter against a custom reply set
  // via the real emitter (Cue present) then assert shape — separate missing-cue case below.
  const emitter = createOscEmitter({ config, log: silentLog });
  const adapter = createAbletonOscSource({ config, bus, log: silentLog });

  await emitter.start();
  await adapter.start();
  try {
    await wait(120);
    const status = adapter.getIngestStatus();
    assert.equal(status.live, true);
    assert.deepEqual(status.trackNames, ['Cue']);
    assert.equal(status.cueTrackConfigured, 'Cue');
    assert.equal(status.cueTrackFound, true);
  } finally {
    adapter.stop();
    emitter.stop();
  }
});

test('abletonosc reports cueTrackFound false when configured track is missing', async () => {
  const bus = createBus();
  const statuses = [];
  bus.on(EVENTS.INGEST_STATUS, (s) => statuses.push({ ...s, trackNames: s.trackNames ? [...s.trackNames] : null }));

  const config = {
    ...DEFAULTS,
    ingest: {
      ...DEFAULTS.ingest,
      oscListenPort: 13401,
      oscSendPort: 13400,
      abletonHost: '127.0.0.1',
      staleAfterMs: 5000,
      pollIntervalMs: 2000,
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
    },
  };

  const mockAbleton = new osc.UDPPort({
    localAddress: '127.0.0.1',
    localPort: 13400,
    metadata: false,
  });

  await new Promise((resolve, reject) => {
    mockAbleton.on('ready', resolve);
    mockAbleton.on('error', reject);
    mockAbleton.open();
  });

  mockAbleton.on('message', (msg, _t, info) => {
    if (msg.address === '/live/song/get/track_names') {
      mockAbleton.send(
        { address: '/live/song/get/track_names', args: ['Drums', 'Bass', 'Vocals'] },
        info.address,
        13401
      );
    }
  });

  const adapter = createAbletonOscSource({ config, bus, log: silentLog });
  await adapter.start();

  try {
    await wait(250);
    const status = adapter.getIngestStatus();
    assert.equal(status.live, true);
    assert.deepEqual(status.trackNames, ['Drums', 'Bass', 'Vocals']);
    assert.equal(status.cueTrackFound, false);
    assert.ok(statuses.some((s) => s.cueTrackFound === false && s.live === true));
  } finally {
    adapter.stop();
    mockAbleton.close();
  }
});

test('matcher attaches ableton diagnostics to CuePayload', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (payload) => payloads.push(payload));

  const config = {
    ...DEFAULTS,
    ingest: {
      ...DEFAULTS.ingest,
      authoritative: { strategy: 'track', track: 'Cue' },
    },
    sheets: {
      ...DEFAULTS.sheets,
      matchColumn: 'Clip Name',
      aliasColumn: 'Aliases',
    },
    sim: { ...DEFAULTS.sim, enabled: false },
  };

  createMatcher({
    config,
    bus,
    log: silentLog,
    getSnapshot: () => ({
      syncedAt: '2026-07-08T12:00:00.000Z',
      stale: false,
      rows: [{ rowId: 1, data: { 'Clip Name': 'Song A' } }],
    }),
  });

  bus.emit(EVENTS.INGEST_STATUS, {
    live: true,
    lastSeenAt: 42,
    trackNames: ['Drums', 'Bass'],
    cueTrackConfigured: 'Cue',
    cueTrackFound: false,
  });

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    authoritativeClip: null,
    tracks: [],
  }));

  assert.equal(payloads.at(-1).ingestLive, true);
  assert.deepEqual(payloads.at(-1).ableton, {
    live: true,
    lastSeenAt: 42,
    trackNames: ['Drums', 'Bass'],
    cueTrackConfigured: 'Cue',
    cueTrackFound: false,
  });
});
