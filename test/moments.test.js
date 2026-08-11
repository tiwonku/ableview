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
  normalizeWho,
  resolveKind,
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
  logger.stop();
});

test('resolveKind defaults to dope', () => {
  assert.equal(resolveKind(undefined, ['dope']), 'dope');
  assert.equal(normalizeWho('  keys '), 'keys');
  assert.equal(normalizeWho(''), null);
});

test('getMomentsStatus reflects last moment', () => {
  const { logger } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show' });
  logger.logMoment({ kind: 'dope', who: 'bass' });
  const status = logger.getMomentsStatus();
  assert.equal(status.sessionLogEnabled, true);
  assert.equal(status.lastMoment.kind, 'dope');
  assert.equal(status.lastMoment.who, 'bass');
  logger.stop();
});
