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
  const { staticColors, ...rest } = overrides;
  return makeLiveColorsStatus({
    enabled: true,
    live: true,
    universe: 191,
    colors,
    staticColors: staticColors ?? colors,
    ...rest,
  });
}

const LOOK = {
  main: { r: 255, g: 110, b: 0 },
  secondary: { r: 255, g: 110, b: 0 },
  accent: { r: 255, g: 161, b: 0 },
};

test('live color gate emits one hold after a static snap', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 25 }),
    onRecord: (r) => records.push(r),
  });
  try {
    gate.handleStatus(liveStatus(LOOK));
    await wait(50);
    assert.equal(records.length, 1);
    assert.equal(records[0].phase, 'hold');
    assert.deepEqual(records[0].colors.main, LOOK.main);
  } finally {
    gate.stop();
  }
});

test('live color gate ignores keepalives of the same look', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 20 }),
    onRecord: (r) => records.push(r),
  });
  try {
    gate.handleStatus(liveStatus(LOOK));
    await wait(40);
    gate.handleStatus(liveStatus(LOOK));
    gate.handleStatus(liveStatus(LOOK));
    await wait(40);
    assert.equal(records.length, 1);
    assert.equal(records[0].phase, 'hold');
  } finally {
    gate.stop();
  }
});

test('live color gate marks move while FX chases a held look', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 30 }),
    onRecord: (r) => records.push(r),
  });
  try {
    gate.handleStatus(liveStatus(LOOK, { staticColors: LOOK }));
    await wait(50);
    let r = 0;
    const timer = setInterval(() => {
      r = Math.min(255, r + 20);
      gate.handleStatus(liveStatus({
        main: { r, g: 0, b: 0 },
        secondary: { r: 0, g: r, b: 0 },
        accent: { r: 0, g: 0, b: r },
      }, { staticColors: LOOK }));
    }, 8);
    await wait(80);
    clearInterval(timer);
    await wait(70);
    assert.ok(records.some((row) => row.phase === 'hold' && row.colors), 'expected a static hold');
    assert.ok(records.some((row) => row.phase === 'move'), 'expected a move span during chase');
    assert.equal(records.at(-1).phase, 'hold');
    assert.equal(records.filter((row) => row.phase === 'move').length, 1);
  } finally {
    gate.stop();
  }
});

test('live color gate logs a new hold when the static look changes mid-chase', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 25 }),
    onRecord: (r) => records.push(r),
  });
  const nextLook = {
    main: { r: 0, g: 255, b: 255 },
    secondary: { r: 0, g: 255, b: 255 },
    accent: { r: 0, g: 255, b: 255 },
  };
  try {
    gate.handleStatus(liveStatus(LOOK, { staticColors: LOOK }));
    await wait(40);
    let r = 10;
    const timer = setInterval(() => {
      r = Math.min(255, r + 15);
      gate.handleStatus(liveStatus({
        main: { r, g: 20, b: 40 },
        secondary: { r: 20, g: r, b: 40 },
        accent: { r: 20, g: 40, b: r },
      }, { staticColors: LOOK }));
    }, 8);
    await wait(50);
    clearInterval(timer);
    gate.handleStatus(liveStatus({
      main: { r: 80, g: 20, b: 40 },
      secondary: { r: 20, g: 80, b: 40 },
      accent: { r: 20, g: 40, b: 80 },
    }, { staticColors: nextLook }));
    await wait(50);
    const holds = records.filter((row) => row.phase === 'hold' && row.colors);
    assert.ok(holds.some((row) => row.colors.main.r === 255));
    assert.ok(holds.some((row) => row.colors.main.r === 0 && row.colors.main.g === 255));
  } finally {
    gate.stop();
  }
});

test('without a static bus, the gate only writes settled FX holds', async () => {
  const records = [];
  const gate = createLiveColorGate({
    getLogConfig: () => ({ changeDelta: 4, settleMs: 20 }),
    onRecord: (r) => records.push(r),
  });
  try {
    gate.handleStatus(makeLiveColorsStatus({
      enabled: true,
      live: true,
      universe: 191,
      colors: LOOK,
    }));
    await wait(40);
    let r = 0;
    const timer = setInterval(() => {
      r = Math.min(255, r + 30);
      gate.handleStatus(makeLiveColorsStatus({
        enabled: true,
        live: true,
        colors: { main: { r, g: 0, b: 0 }, secondary: LOOK.secondary, accent: LOOK.accent },
      }));
    }, 8);
    await wait(50);
    clearInterval(timer);
    await wait(40);
    assert.ok(records.every((row) => row.phase === 'hold'));
    assert.equal(records.filter((row) => row.phase === 'move').length, 0);
  } finally {
    gate.stop();
  }
});

test('session log writes live_color hold events with clip context', async () => {
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
      log: { changeDelta: 4, settleMs: 20 },
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
  }, {
    staticColors: {
      main: { r: 8, g: 16, b: 32 },
      secondary: { r: 0, g: 0, b: 0 },
      accent: { r: 255, g: 255, b: 255 },
    },
  }));
  await wait(45);

  const file = join(dir, 'test.jsonl');
  assert.ok(existsSync(file));
  const lines = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const colorLines = lines.filter((l) => l.event === 'live_color');
  assert.equal(colorLines.length, 1);
  assert.equal(colorLines[0].phase, 'hold');
  assert.equal(colorLines[0].clipName, 'Song B - Drop');
  assert.equal(colorLines[0].rowId, '12');
  assert.equal(colorLines[0].universe, 191);
  assert.deepEqual(colorLines[0].colors.main, { r: 8, g: 16, b: 32 });

  logger.stop();
});
