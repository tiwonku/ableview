import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { createSessionLogger } from '../src/session-log/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function tempLogger(logHeartRates) {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-orbit-log-'));
  const config = {
    ...DEFAULTS,
    orbit: { ...DEFAULTS.orbit, logHeartRates },
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
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
    cwd: process.cwd(),
  });
  return { logger, bus, config, dir };
}

function readLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function reading(partial = {}) {
  return {
    memberId: '70bd015b-033e-4582-bbd8-0af16e44c0a7',
    memberName: 'nik',
    heartRate: 91,
    heartRateAvg: 91,
    calories: 23.587,
    batteryLevel: 100,
    bandId: 'PrettyLights',
    measuredAt: '2026-05-24T19:38:01.000Z',
    ...partial,
  };
}

test('heart rates are written only when the show log and the orbit checkbox are on', () => {
  const off = tempLogger(false);
  off.logger.start();
  off.logger.applyPatch({ enabled: true, sessionName: 'show-night-1' });
  off.bus.emit(EVENTS.ORBIT_HEART_RATE, reading());
  assert.equal(readLines(join(off.dir, 'show-night-1.jsonl')).length, 0);
  off.logger.stop();

  const { logger, bus, config, dir } = tempLogger(true);
  logger.start();
  bus.emit(EVENTS.ORBIT_HEART_RATE, reading());
  assert.equal(existsSync(join(dir, 'test.jsonl')), false);

  logger.applyPatch({ enabled: true, sessionName: 'show-night-1' });
  bus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song A',
    tempo: 128,
    beat: 12,
    match: makeMatchResult({ matched: true, confidence: 0.9, rowId: 'row-1' }),
  }));
  bus.emit(EVENTS.ORBIT_HEART_RATE, reading());

  const lines = readLines(join(dir, 'show-night-1.jsonl')).filter((row) => row.event === 'heart_rate');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].memberName, 'nik');
  assert.equal(lines[0].heartRate, 91);
  assert.equal(lines[0].heartRateAvg, 91);
  assert.equal(lines[0].batteryLevel, 100);
  assert.equal(lines[0].calories, 23.587);
  assert.equal(lines[0].bandId, 'PrettyLights');
  assert.equal(lines[0].measuredAt, '2026-05-24T19:38:01.000Z');
  assert.equal(lines[0].clipName, 'Song A');
  assert.equal(lines[0].rowId, 'row-1');
  assert.equal(lines[0].tempo, 128);
  assert.equal(lines[0].beat, 12);
  assert.equal(lines[0].sessionName, 'show-night-1');

  config.orbit = { ...config.orbit, logHeartRates: false };
  bus.emit(EVENTS.ORBIT_HEART_RATE, reading({ heartRate: 99 }));
  const after = readLines(join(dir, 'show-night-1.jsonl')).filter((row) => row.event === 'heart_rate');
  assert.equal(after.length, 1);
  logger.stop();
});
