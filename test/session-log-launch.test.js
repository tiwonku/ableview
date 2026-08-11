import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { makeSceneInfo } from '../src/ingest/scene-launch.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function tempLogger() {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-log-'));
  const config = {
    ...DEFAULTS,
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
  return { logger, bus, dir };
}

function readLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('launch event logged once per launchId with summary', () => {
  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });

  const scene = makeSceneInfo({
    launchType: 'scene',
    index: 4,
    name: 'Drop',
    launchId: 1,
    pending: true,
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      authoritativeClip: 'Song A',
      tracks: [{ trackIndex: 0, trackName: 'A', clipName: 'Song A', slotIndex: 4 }],
      scene,
      pendingLaunch: true,
    }),
  );

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      authoritativeClip: 'Song A',
      tracks: [{ trackIndex: 0, trackName: 'A', clipName: 'Song A', slotIndex: 4 }],
      scene: { ...scene, pending: false },
      pendingLaunch: false,
    }),
  );

  const lines = readLines(join(dir, 'test.jsonl'));
  const launches = lines.filter((l) => l.event === 'launch');
  assert.equal(launches.length, 1);
  assert.equal(launches[0].launchType, 'scene');
  assert.equal(launches[0].sceneIndex, 4);

  const status = logger.getStatus();
  assert.equal(status.launchSummary.sceneLaunches, 1);
  assert.equal(status.launchSummary.clipLaunches, 0);
  assert.equal(status.launchSummary.totalLaunches, 1);

  logger.stop();
});

test('clip and scene launches increment separate counters', () => {
  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      scene: makeSceneInfo({ launchType: 'scene', index: 1, launchId: 1 }),
      tracks: [],
    }),
  );
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      scene: makeSceneInfo({
        launchType: 'clip',
        index: 2,
        trackName: 'B',
        launchId: 2,
      }),
      tracks: [],
    }),
  );

  const status = logger.getStatus();
  assert.equal(status.launchSummary.sceneLaunches, 1);
  assert.equal(status.launchSummary.clipLaunches, 1);
  assert.equal(status.launchSummary.totalLaunches, 2);

  logger.stop();
});
