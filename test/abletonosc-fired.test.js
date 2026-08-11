import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { createAbletonOscSource } from '../src/ingest/sources/abletonosc.js';
import { createOscEmitter } from '../src/sim/osc-emitter.js';
import { DEFAULTS } from '../src/config/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

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
      ...overrides,
    },
    ingest: {
      ...DEFAULTS.ingest,
      oscListenPort: 12001,
      oscSendPort: 12000,
      abletonHost: '127.0.0.1',
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
    },
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('osc sim: fired clip becomes authoritative before playing slot updates', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const config = oscTestConfig();
  const emitter = createOscEmitter({ config, log: silentLog });
  const adapter = createAbletonOscSource({ config, bus, log: silentLog });

  await emitter.start();
  await adapter.start();

  try {
    await wait(40);
    assert.equal(events.at(-1)?.authoritativeClip, 'Song A - Intro');

    // Step 2 fires while Song A is still playing (hold 250ms, quant 100ms).
    await wait(220);

    const pending = events.at(-1);
    assert.equal(pending?.authoritativeClip, 'Song B - Verse', 'switch on fire, not downbeat');
    assert.equal(pending?.pendingLaunch, true);
    assert.equal(pending?.tracks[0]?.clipName, 'Song B - Verse', 'tracks expose fired-or-playing candidate');

    await wait(120);
    const playing = events.at(-1);
    assert.equal(playing?.authoritativeClip, 'Song B - Verse', 'unchanged after playing catches up');
    assert.equal(playing?.pendingLaunch, false, 'fired pill clears when playing catches up');
    assert.equal(playing?.tracks[0]?.clipName, 'Song B - Verse');
    assert.ok(
      !events.some((e, i) => i > 0 && e.authoritativeClip === 'Song A - Intro' && events[i - 1]?.authoritativeClip === 'Song B - Verse'),
      'should not flash back to previous song after launch'
    );
  } finally {
    adapter.stop();
    emitter.stop();
  }
});
