import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { makeLiveColorsStatus } from '../src/core/live-colors.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';
import { createLiveColorGate } from '../src/session-log/live-color.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function liveStatus(colors, overrides = {}) {
  return makeLiveColorsStatus({
    enabled: true,
    live: true,
    universe: 191,
    colors,
    ...overrides,
  });
}

test('live color gate emits one settled record after a snap', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 25, motionIntervalMs: 200, minIntervalMs: 0 }),
    onRecord: (r) => records.push(r),
  });
  try {
    gate.handleStatus(liveStatus({
      main: { r: 255, g: 0, b: 0 },
      secondary: { r: 0, g: 0, b: 0 },
      accent: { r: 0, g: 0, b: 0 },
    }));
    await wait(50);
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, 'settled');
    assert.deepEqual(records[0].colors.main, { r: 255, g: 0, b: 0 });
  } finally {
    gate.stop();
  }
});

test('live color gate ignores keepalives of the same look', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 20, motionIntervalMs: 200, minIntervalMs: 0 }),
    onRecord: (r) => records.push(r),
  });
  const look = {
    main: { r: 10, g: 20, b: 30 },
    secondary: { r: 1, g: 2, b: 3 },
    accent: { r: 4, g: 5, b: 6 },
  };
  try {
    gate.handleStatus(liveStatus(look));
    await wait(40);
    gate.handleStatus(liveStatus(look));
    gate.handleStatus(liveStatus(look));
    await wait(40);
    assert.equal(records.length, 1);
    assert.equal(records[0].reason, 'settled');
  } finally {
    gate.stop();
  }
});

test('live color gate samples motion during a chase then settles', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 35, motionIntervalMs: 25, minIntervalMs: 0 }),
    onRecord: (r) => records.push(r),
  });
  try {
    let r = 0;
    const timer = setInterval(() => {
      r = Math.min(255, r + 20);
      gate.handleStatus(liveStatus({
        main: { r, g: 0, b: 0 },
        secondary: { r: 0, g: r, b: 0 },
        accent: { r: 0, g: 0, b: r },
      }));
    }, 8);
    await wait(90);
    clearInterval(timer);
    await wait(80);
    assert.ok(records.some((row) => row.reason === 'motion'), 'expected motion samples during chase');
    assert.equal(records.at(-1).reason, 'settled');
  } finally {
    gate.stop();
  }
});

test('session log writes live_color events with clip context', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-live-color-'));
  const config = {
    ...DEFAULTS,
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
    },
    sacn: {
      ...DEFAULTS.sacn,
      log: { changeDelta: 4, settleMs: 20, motionIntervalMs: 200, minIntervalMs: 0 },
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
  });
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });

  bus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song B - Drop',
    match: makeMatchResult({ matched: true, confidence: 0.9, rowId: '12' }),
  }));
  bus.emit(EVENTS.LIVE_COLORS, liveStatus({
    main: { r: 8, g: 16, b: 32 },
    secondary: { r: 0, g: 0, b: 0 },
    accent: { r: 255, g: 255, b: 255 },
  }));
  await wait(45);

  const file = join(dir, 'test.jsonl');
  assert.ok(existsSync(file));
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const colorLines = lines.filter((l) => l.event === 'live_color');
  assert.equal(colorLines.length, 1);
  assert.equal(colorLines[0].reason, 'settled');
  assert.equal(colorLines[0].clipName, 'Song B - Drop');
  assert.equal(colorLines[0].rowId, '12');
  assert.equal(colorLines[0].universe, 191);
  assert.deepEqual(colorLines[0].colors.main, { r: 8, g: 16, b: 32 });

  logger.stop();
});
