import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';
import { generateAutoSessionName } from '../src/session-log/auto-session-name.js';
import {
  SessionLogDisabledError,
  MomentDebouncedError,
  NoteRequiredError,
  normalizeWho,
  resolveKind,
  effectiveMomentKinds,
} from '../src/session-log/moments.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function tempLogger(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-moments-'));
  const config = {
    ...DEFAULTS,
    sessionLog: {
      directory: dir,
      autoStart: false,
      autoStartWhenSim: false,
      defaultSessionName: 'test',
    },
    moments: {
      autoStartOnMoment: true,
      kinds: ['dope', 'not_dope'],
      debounceMs: 0,
      ...overrides.moments,
    },
    sim: { ...DEFAULTS.sim, enabled: false },
    ...overrides.config,
  };
  const bus = overrides.bus ?? createBus();
  let changeCount = 0;
  const logger = createSessionLogger({
    bus,
    getConfig: () => config,
    getTimecodeStatus: overrides.getTimecodeStatus ?? (() => ({ enabled: false })),
    getSimulated: () => config.sim.enabled === true,
    log: silentLog,
    onSessionLogChange: () => { changeCount += 1; },
  });
  return { logger, bus, config, dir, getChangeCount: () => changeCount };
}

function readLines(dir, name) {
  const file = join(dir, `${name}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('generateAutoSessionName produces filesystem-safe timestamp basename', () => {
  const name = generateAutoSessionName(new Date(2026, 7, 11, 21, 15, 4));
  assert.equal(name, '2026-08-11_211504');
});

test('logMoment appends moment line when logging enabled', () => {
  const { logger, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });

  const result = logger.logMoment({ kind: 'dope', who: 'keys' });
  assert.equal(result.kind, 'dope');
  assert.equal(result.who, 'keys');
  assert.equal(result.sessionName, 'show');
  assert.equal(result.sessionLogStarted, undefined);

  const lines = readLines(dir, 'show');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'moment');
  assert.equal(lines[0].kind, 'dope');
  assert.equal(lines[0].who, 'keys');
  assert.match(lines[0].timestamp, /^\d{2}:\d{2}:\d{2}:/);

  logger.stop();
});

test('logMoment auto-starts with timestamp session name when disabled', () => {
  const { logger, dir } = tempLogger();
  logger.start();

  const result = logger.logMoment({ kind: 'dope' });
  assert.equal(result.sessionLogStarted, true);
  assert.match(result.sessionName, /^\d{4}-\d{2}-\d{2}_\d{6}$/);

  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  assert.equal(files[0], `${result.sessionName}.jsonl`);

  const lines = readLines(dir, result.sessionName);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].event, 'moment');

  logger.stop();
});

test('logMoment rejects when autoStartOnMoment is false and logging off', () => {
  const { logger } = tempLogger({ moments: { autoStartOnMoment: false } });
  logger.start();
  assert.throws(() => logger.logMoment({ kind: 'dope' }), SessionLogDisabledError);
  logger.stop();
});

test('logMoment rejects unknown kind', () => {
  const { logger } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  assert.throws(() => logger.logMoment({ kind: 'nope' }), /Unknown moment kind/);
  logger.stop();
});

test('who is optional', () => {
  const { logger, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  const result = logger.logMoment({ kind: 'dope' });
  assert.equal(result.who, null);
  const lines = readLines(dir, 'show');
  assert.equal(lines[0].who, null);
  logger.stop();
});

test('debounce suppresses duplicate kind+who', () => {
  const { logger, dir } = tempLogger({ moments: { debounceMs: 500 } });
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'keys' });
  assert.throws(() => logger.logMoment({ kind: 'dope', who: 'keys' }), MomentDebouncedError);
  const lines = readLines(dir, 'show');
  assert.equal(lines.length, 1);
  assert.deepEqual(logger.getMomentsStatus().dopeTally, [{ who: 'keys', count: 1 }]);
  logger.stop();
});

test('resolveKind defaults to dope', () => {
  assert.equal(resolveKind(undefined, ['dope']), 'dope');
  assert.equal(normalizeWho('  keys '), 'keys');
  assert.equal(normalizeWho(''), null);
});

test('getMomentsStatus reflects last moment and count', () => {
  const { logger } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'bass' });
  logger.logMoment({ kind: 'dope', who: 'keys' });
  const status = logger.getMomentsStatus();
  assert.equal(status.sessionLogEnabled, true);
  assert.equal(status.momentCount, 2);
  assert.equal(status.lastMoment.kind, 'dope');
  assert.equal(status.lastMoment.who, 'keys');
  assert.match(status.lastMoment.timestamp, /^\d{2}:\d{2}:\d{2}[:;]\d{2}$/);
  assert.equal(typeof status.lastMoment.timestampSource, 'string');
  logger.stop();
});

test('typed moment requires a note and does not auto-start on reject', () => {
  const { logger, dir } = tempLogger({ moments: { kinds: ['dope'] } });
  logger.start();
  assert.throws(() => logger.logMoment({ kind: 'typed' }), NoteRequiredError);
  assert.throws(() => logger.logMoment({ kind: 'typed', note: '   ' }), NoteRequiredError);
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  assert.equal(files.length, 0);

  logger.applyPatch({ enabled: true, sessionName: 'show' });
  const result = logger.logMoment({ kind: 'typed', who: 'setlist', note: 'crowd surge' });
  assert.equal(result.kind, 'typed');
  assert.equal(result.who, 'setlist');
  const lines = readLines(dir, 'show');
  assert.equal(lines[0].kind, 'typed');
  assert.equal(lines[0].note, 'crowd surge');
  logger.stop();
});

test('typed is accepted even when omitted from config kinds', () => {
  assert.deepEqual(effectiveMomentKinds(['dope', 'not_dope']), ['dope', 'typed', 'not_dope']);
  assert.equal(resolveKind('typed', ['dope']), 'typed');
});

test('dope still logs with a null note', () => {
  const { logger, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'visuals' });
  const lines = readLines(dir, 'show');
  assert.equal(lines[0].kind, 'dope');
  assert.equal(lines[0].who, 'visuals');
  assert.equal(lines[0].note, null);
  logger.stop();
});

test('dope tally counts who for this session and skips typed notes', () => {
  const { logger, config } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'Bass' });
  logger.logMoment({ kind: 'dope', who: 'Keys' });
  logger.logMoment({ kind: 'dope', who: 'Keys' });
  logger.logMoment({ kind: 'typed', who: 'setlist', note: 'crowd surge' });
  logger.logMoment({ kind: 'dope' });

  assert.deepEqual(logger.getMomentsStatus().dopeTally, [
    { who: 'Keys', count: 2 },
    { who: 'Bass', count: 1 },
    { who: null, count: 1 },
  ]);

  logger.applyPatch({ enabled: false });
  assert.deepEqual(logger.getMomentsStatus().dopeTally, []);
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  assert.equal(logger.getMomentsStatus().dopeTally[0].who, 'Keys');
  logger.stop();

  const restored = createSessionLogger({
    bus: createBus(),
    getConfig: () => config,
    getTimecodeStatus: () => ({ enabled: false }),
    getSimulated: () => false,
    log: silentLog,
  });
  restored.start();
  restored.applyPatch({ enabled: true, sessionName: 'show' });
  assert.deepEqual(restored.getMomentsStatus().dopeTally, [
    { who: 'Keys', count: 2 },
    { who: 'Bass', count: 1 },
    { who: null, count: 1 },
  ]);

  restored.applyPatch({ enabled: true, sessionName: 'next' });
  assert.deepEqual(restored.getMomentsStatus().dopeTally, []);
  restored.logMoment({ kind: 'dope', who: 'Drums' });
  assert.deepEqual(restored.getMomentsStatus().dopeTally, [{ who: 'Drums', count: 1 }]);
  restored.stop();
});

test('equal dope counts stay in first-press order', () => {
  const { logger } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'Bass' });
  logger.logMoment({ kind: 'dope', who: 'Keys' });
  assert.deepEqual(logger.getMomentsStatus().dopeTally, [
    { who: 'Bass', count: 1 },
    { who: 'Keys', count: 1 },
  ]);
  logger.stop();
});

test('logMoment returns feedbackState success and momentCount', () => {
  const { logger } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  const result = logger.logMoment({ kind: 'dope', who: 'drums' });
  assert.equal(result.feedbackState, 'success');
  assert.equal(result.momentCount, 1);
  logger.stop();
});
