import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { makeCuePayload, makeMatchResult } from '../src/core/cue-payload.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';
import { COLOR_SIM_SOURCE_NAME } from '../src/sacn/loopback.js';
import { sanitizeSessionName } from '../src/session-log/sanitize.js';
import { resolveLogTimestamp } from '../src/session-log/timestamp.js';
import { diffTracks, trackStateKey } from '../src/session-log/tracks.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function tempLogger(overrides = {}) {
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
    ...overrides.config,
  };
  const bus = overrides.bus ?? createBus();
  const getTimecodeStatus = overrides.getTimecodeStatus ?? (() => ({ enabled: false }));

  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus,
    getSimulated: () => config.sim.enabled === true,
    log: silentLog,
    cwd: process.cwd(),
    capture: overrides.capture,
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

function sessionFile(dir, name = 'test') {
  return join(dir, `${name}.jsonl`);
}

test('sanitizeSessionName rejects path traversal', () => {
  assert.throws(() => sanitizeSessionName('../evil'), /non-empty string/);
  assert.throws(() => sanitizeSessionName(''), /non-empty string/);
  assert.equal(sanitizeSessionName('  show night 1  '), 'show-night-1');
});

test('resolveLogTimestamp uses Art-Net when live', () => {
  const ts = resolveLogTimestamp(() => ({
    enabled: true,
    live: true,
    timecode: { display: '01:02:03:04' },
  }));
  assert.equal(ts.timestamp, '01:02:03:04');
  assert.equal(ts.timestampSource, 'artnet');
});

test('resolveLogTimestamp falls back to clock', () => {
  const ts = resolveLogTimestamp(() => ({ enabled: true, live: false }));
  assert.match(ts.timestamp, /^\d{2}:\d{2}:\d{2}:00$/);
  assert.equal(ts.timestampSource, 'clock');
});

test('diffTracks detects per-track clip changes', () => {
  const prev = trackStateKey([
    { trackIndex: 0, clipName: 'Song A', slotIndex: 0 },
    { trackIndex: 3, clipName: null, slotIndex: null },
  ]);
  const changed = diffTracks(prev, [
    { trackIndex: 0, trackName: 'Cue', clipName: 'Song A', slotIndex: 0 },
    { trackIndex: 3, trackName: 'Vocals', clipName: 'Sample Hit', slotIndex: 4 },
  ]);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].trackName, 'Vocals');
  assert.equal(changed[0].clipName, 'Sample Hit');
});

test('track_clip logged on watched-track change only', () => {
  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
      tracks: [
        { trackIndex: 0, trackName: 'Cue', clipName: 'Song A - Intro', slotIndex: 0 },
        { trackIndex: 3, trackName: 'Vocals', clipName: null, slotIndex: null },
      ],
    })
  );

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
      tracks: [
        { trackIndex: 0, trackName: 'Cue', clipName: 'Song A - Intro', slotIndex: 0 },
        { trackIndex: 3, trackName: 'Vocals', clipName: 'Sample Hit', slotIndex: 4 },
      ],
    })
  );

  const lines = readLines(sessionFile(dir));
  assert.equal(lines.length, 3);
  assert.equal(lines[0].event, 'track_clip');
  assert.equal(lines[0].trackName, 'Cue');
  assert.equal(lines[1].event, 'track_clip');
  assert.equal(lines[1].trackName, 'Vocals');
  assert.equal(lines[1].clipName, null);
  assert.equal(lines[2].event, 'track_clip');
  assert.equal(lines[2].trackName, 'Vocals');
  assert.equal(lines[2].clipName, 'Sample Hit');

  logger.stop();
});

test('match logged on clip change and match_change on rematch', () => {
  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });

  const payload1 = makeCuePayload({
    clipName: 'Song A - Intro',
    match: makeMatchResult({
      matched: true,
      confidence: 0.95,
      rowId: '5',
      matchedValue: 'Song A - Intro',
    }),
    row: { Key: 'A minor' },
    syncedAt: '2026-07-07T20:00:00.000Z',
    stale: false,
    tempo: 128,
    beat: 1,
  });

  bus.emit(EVENTS.CUE_PAYLOAD, payload1);

  bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      ...payload1,
      tempo: 128,
      beat: 2,
    })
  );

  bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'Song A - Intro',
      match: makeMatchResult({
        matched: true,
        confidence: 0.95,
        rowId: '6',
        matchedValue: 'Song A - Intro',
      }),
      row: { Key: 'A minor' },
      syncedAt: '2026-07-07T20:05:00.000Z',
      stale: false,
      tempo: 128,
      beat: 2,
    })
  );

  const lines = readLines(sessionFile(dir));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'match');
  assert.equal(lines[0].reason, 'clip_change');
  assert.equal(lines[1].event, 'match');
  assert.equal(lines[1].reason, 'match_change');
  assert.equal(lines[1].match.rowId, '6');

  logger.stop();
});

test('rotate creates separate session files', () => {
  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'first' });

  bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'Clip One',
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt: null,
      stale: false,
    })
  );

  logger.applyPatch({ sessionName: 'second' });

  bus.emit(
    EVENTS.CUE_PAYLOAD,
    makeCuePayload({
      clipName: 'Clip Two',
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt: null,
      stale: false,
    })
  );

  assert.equal(readLines(sessionFile(dir, 'first')).length, 1);
  assert.equal(readLines(sessionFile(dir, 'second')).length, 1);
  assert.ok(existsSync(sessionFile(dir, 'first')));
  assert.ok(existsSync(sessionFile(dir, 'second')));

  logger.stop();
});

test('autoStartWhenSim enables logging on start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-log-'));
  const config = {
    ...DEFAULTS,
    sim: { ...DEFAULTS.sim, enabled: true },
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: true,
      defaultSessionName: 'test',
    },
  };
  const bus = createBus();
  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => true,
    log: silentLog,
  });

  logger.start();
  assert.equal(logger.getStatus().enabled, true);
  logger.stop();
});

test('seq starts at 1 for a log title and continues after restart', () => {
  const { logger, bus, dir, config } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'cap-night' });

  bus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song A',
    match: makeMatchResult({ matched: false, confidence: 0 }),
    syncedAt: null,
    stale: false,
  }));

  const first = readLines(sessionFile(dir, 'cap-night'));
  assert.equal(first.length, 1);
  assert.equal(first[0].seq, 1);
  assert.equal(first[0].lineId, '1');

  const sidecarPath = join(dir, '.active.json');
  const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  sidecar.lineCount = 0;
  writeFileSync(sidecarPath, JSON.stringify(sidecar));

  const nextBus = createBus();
  const resumed = createSessionLogger({
    bus: nextBus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
  });
  resumed.start();

  nextBus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song B',
    match: makeMatchResult({ matched: false, confidence: 0 }),
    syncedAt: null,
    stale: false,
  }));

  const lines = readLines(sessionFile(dir, 'cap-night'));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].seq, 2);
  assert.equal(lines[1].lineId, '2');

  resumed.applyPatch({ sessionName: 'cap-night-2' });
  nextBus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song C',
    match: makeMatchResult({ matched: false, confidence: 0 }),
    syncedAt: null,
    stale: false,
  }));
  const rotated = readLines(sessionFile(dir, 'cap-night-2'));
  assert.equal(rotated[0].seq, 1);
  assert.equal(rotated[0].lineId, '1');

  logger.stop();
  resumed.stop();
});

function mockCapture() {
  const queued = [];
  let enabled = false;
  return {
    queued,
    setOnChange() {},
    start() {},
    stop() {},
    enable() {
      enabled = true;
      return { ok: true };
    },
    disable() {
      enabled = false;
    },
    isEnabled() {
      return enabled;
    },
    enqueue(record) {
      queued.push(record);
    },
    catchUp() {
      return 0;
    },
    getStatus() {
      return { enabled, configured: true, pending: queued.length, lastError: null };
    },
    forget() {},
  };
}

test('Ableton sim clips are logged as simulated and queued for the website', () => {
  const capture = mockCapture();
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-log-'));
  const config = {
    ...DEFAULTS,
    sim: { ...DEFAULTS.sim, enabled: true },
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: true,
      defaultSessionName: 'rehearsal',
    },
  };
  const bus = createBus();
  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => true,
    log: silentLog,
    capture,
  });
  logger.start();

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.SIMULATOR,
    authoritativeClip: 'Song A',
    tempo: 100,
    tracks: [
      { trackIndex: 0, trackName: 'Cue', clipName: 'Song A', slotIndex: 1 },
    ],
  }));
  bus.emit(EVENTS.CUE_PAYLOAD, makeCuePayload({
    clipName: 'Song A',
    match: makeMatchResult({ matched: true, confidence: 0.9, rowId: '4' }),
    simulated: true,
  }));

  const lines = readLines(sessionFile(dir, 'rehearsal'));
  assert.equal(lines.filter((line) => line.event === 'track_clip' && line.simulated === true).length, 1);
  assert.equal(lines.filter((line) => line.event === 'match' && line.simulated === true).length, 1);
  assert.equal(capture.isEnabled(), true);
  assert.equal(capture.queued.filter((line) => line.simulated === true).length, 2);

  logger.stop();
});

test('color sim holds are logged as simulated and queued for the website', async () => {
  const capture = mockCapture();
  const dir = mkdtempSync(join(tmpdir(), 'ableview-session-log-'));
  const config = {
    ...DEFAULTS,
    sim: { ...DEFAULTS.sim, enabled: false },
    sacn: {
      ...DEFAULTS.sacn,
      sim: { enabled: true },
      log: { changeDelta: 4, settleMs: 20 },
    },
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: true,
      defaultSessionName: 'rehearsal',
    },
  };
  const bus = createBus();
  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
    capture,
  });
  logger.start();

  bus.emit(EVENTS.LIVE_COLORS, {
    enabled: true,
    live: true,
    universe: 191,
    sourceName: COLOR_SIM_SOURCE_NAME,
    colors: {
      main: { r: 255, g: 0, b: 80 },
      secondary: { r: 80, g: 0, b: 255 },
      accent: { r: 255, g: 220, b: 0 },
    },
    staticColors: {
      main: { r: 255, g: 80, b: 0 },
      secondary: { r: 0, g: 40, b: 255 },
      accent: { r: 20, g: 200, b: 80 },
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const lines = readLines(sessionFile(dir, 'rehearsal'));
  const color = lines.filter((line) => line.event === 'live_color');
  assert.equal(color.length, 1);
  assert.equal(color[0].phase, 'hold');
  assert.equal(color[0].simulated, true);
  assert.equal(color[0].sourceName, COLOR_SIM_SOURCE_NAME);
  assert.deepEqual(color[0].colors.main, { r: 255, g: 80, b: 0 });
  assert.equal(capture.isEnabled(), true);
  assert.equal(capture.queued.filter((line) => line.event === 'live_color' && line.simulated === true).length, 1);

  logger.stop();
});
