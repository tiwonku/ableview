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
    'scene',
    'source',
    'tempo',
    'timestamp',
    'tracks',
  ]);
  assert.equal(e.tracks[0].clipName, 'Song A - Intro');
  assert.equal(e.scene?.launchType, 'clip');
  assert.equal(e.scene?.launchId, 1);
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

test('manual fire pauses scenario auto-advance', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({
    config: simConfig({
      driver: 'scenario',
      scenario: './config/scenarios/demo-set.json',
      intervalSeconds: 0.05,
    }),
    bus,
    log: silentLog,
  });
  await sim.start();
  assert.equal(events.length, 1);
  assert.equal(events[0].authoritativeClip, 'Song A - Intro');

  sim.fire('Manual Override');
  assert.equal(events.length, 2);
  assert.equal(events[1].authoritativeClip, 'Manual Override');

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(events.length, 2, 'auto-advance should stay paused after manual fire');

  sim.stop();
});

test('clear emits nothing playing and pauses auto-advance', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({
    config: simConfig({
      driver: 'scenario',
      scenario: './config/scenarios/demo-set.json',
      intervalSeconds: 0.05,
    }),
    bus,
    log: silentLog,
  });
  await sim.start();
  sim.clear();
  assert.equal(events.at(-1).authoritativeClip, null);
  assert.deepEqual(events.at(-1).tracks, []);

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(events.length, 2, 'auto-advance should stay paused after clear');

  sim.stop();
});

test('pause stops auto-advance and resume continues', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({
    config: simConfig({
      driver: 'scenario',
      scenario: './config/scenarios/demo-set.json',
      intervalSeconds: 0.05,
    }),
    bus,
    log: silentLog,
  });
  await sim.start();
  assert.equal(events.length, 1);
  assert.equal(events[0].authoritativeClip, 'Song A - Intro');

  sim.pause();
  assert.equal(sim.getStatus().paused, true);

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(events.length, 1, 'paused sim should not auto-advance');

  sim.resume();
  assert.equal(sim.getStatus().paused, false);

  await new Promise((r) => setTimeout(r, 120));
  assert.ok(events.length >= 2, 'resumed sim should auto-advance');
  assert.equal(events[1].authoritativeClip, 'Song A - Drop');

  sim.stop();
});

test('step next and prev walk scenario clips', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const sim = createSimulatorSource({
    config: simConfig({
      driver: 'scenario',
      scenario: './config/scenarios/demo-set.json',
    }),
    bus,
    log: silentLog,
  });
  await sim.start();
  sim.pause();

  sim.step('next');
  assert.equal(events.at(-1).authoritativeClip, 'Song A - Drop');

  sim.step('prev');
  assert.equal(events.at(-1).authoritativeClip, 'Song A - Intro');

  sim.stop();
});

test('getStatus returns clip names for scenario driver', async () => {
  const sim = createSimulatorSource({
    config: simConfig({
      driver: 'scenario',
      scenario: './config/scenarios/demo-set.json',
    }),
    bus: createBus(),
    log: silentLog,
  });
  await sim.start();

  const status = sim.getStatus();
  assert.equal(status.driver, 'scenario');
  assert.equal(status.canAutoAdvance, true);
  assert.ok(status.clipNames.includes('Song A - Intro'));
  assert.ok(status.clipNames.includes('Song B - Verse'));

  sim.stop();
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

test('track strategy requires an authoritative track; bestMatch does not', () => {
  const best = structuredClone(DEFAULTS);
  best.ingest.authoritative = { strategy: 'bestMatch', track: null };
  assert.equal(validateConfig(best), best);

  const track = structuredClone(DEFAULTS);
  track.ingest.authoritative = { strategy: 'track', track: null };
  assert.throws(() => validateConfig(track), /authoritative\.track/);
  track.ingest.authoritative.track = 'Cue';
  assert.equal(validateConfig(track), track);
});
