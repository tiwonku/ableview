import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { createSimulatorSource } from '../src/ingest/sources/simulator.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function simConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    sim: { ...DEFAULTS.sim, enabled: true, driver: 'manual', ...overrides },
  };
}

test('manual driver emits a NowPlaying event matching the §9.1 contract', () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({ config: simConfig(), bus, log: silentLog });
  sim.fire('Song A - Intro', { tempo: 128 });
  sim.stop();

  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.source, 'simulator');
  assert.equal(e.authoritativeClip, 'Song A - Intro');
  assert.equal(e.tempo, 128);
  assert.ok(!Number.isNaN(Date.parse(e.timestamp)), 'timestamp is ISO-8601');
  assert.deepEqual(Object.keys(e).sort(), [
    'authoritativeClip',
    'beat',
    'pendingLaunch',
    'source',
    'tempo',
    'timestamp',
    'tracks',
  ]);
  assert.equal(e.tracks[0].clipName, 'Song A - Intro');
});

test('firing null clip means nothing playing', () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({ config: simConfig(), bus, log: silentLog });
  sim.fire(null);
  sim.stop();

  assert.equal(events[0].authoritativeClip, null);
  assert.deepEqual(events[0].tracks, []);
});

test('scenario driver walks the demo scenario file', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({
    config: simConfig({ driver: 'scenario', scenario: './config/scenarios/demo-set.json' }),
    bus,
    log: silentLog,
  });
  await sim.start();
  sim.stop();

  assert.equal(events.length, 1, 'first step emitted immediately');
  assert.equal(events[0].authoritativeClip, 'Song A - Intro');
  assert.equal(events[0].source, 'simulator');
});

test('sheetClipNames driver without sheets provider fails loudly, not silently', async () => {
  const sim = createSimulatorSource({
    config: simConfig({ driver: 'sheetClipNames' }),
    bus: createBus(),
    log: silentLog,
  });
  await assert.rejects(() => sim.start(), /sheetClipNames/);
});

test('config validation rejects bad values', () => {
  const bad = structuredClone(DEFAULTS);
  bad.ingest.oscListenPort = 999999;
  bad.sim.driver = 'nonsense';
  assert.throws(() => validateConfig(bad), /oscListenPort[\s\S]*driver/);
});

test('default config requires an authoritative track for the track strategy', () => {
  const cfg = structuredClone(DEFAULTS);
  assert.throws(() => validateConfig(cfg), /authoritative\.track/);
  cfg.ingest.authoritative.track = 'Cue';
  assert.equal(validateConfig(cfg), cfg);
});
