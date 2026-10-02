import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { DEFAULTS } from '../src/config/index.js';
import { createSessionLogger } from '../src/session-log/index.js';
import { observeSourceOnAir, onAirTransitions } from '../src/session-log/deck-on-air.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function deck(partial) {
  return {
    deckIndex: 1,
    loaded: { title: 'Song A', artist: 'Artist A' },
    playing: true,
    onAir: false,
    bpm: 120,
    key: 'a minor',
    ...partial,
  };
}

function source(partial) {
  return {
    id: 'djay-d',
    label: 'D',
    live: true,
    stale: false,
    decks: [],
    ...partial,
  };
}

function programState(sources) {
  return { timestamp: '2026-08-11T02:15:04.520Z', sources };
}

function tempLogger(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-deck-on-air-'));
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

test('observeSourceOnAir ignores stale sources and decks that are not on air', () => {
  assert.equal(observeSourceOnAir(source({ stale: true, decks: [deck({ onAir: true })] })), null);
  assert.equal(observeSourceOnAir(source({ live: false, decks: [deck({ onAir: true })] })), null);
  assert.deepEqual(observeSourceOnAir(source({
    decks: [
      deck({ deckIndex: 2, onAir: false, loaded: { title: 'Loaded only', artist: null } }),
      deck({ deckIndex: 1, onAir: true, playing: true }),
    ],
  })), [
    {
      sourceId: 'djay-d',
      sourceLabel: 'D',
      deckIndex: 1,
      title: 'Song A',
      artist: 'Artist A',
      bpm: 120,
      key: 'a minor',
    },
  ]);
});

test('onAirTransitions logs a title change and a crossfade, not a still-on-air deck', () => {
  const deckA = {
    sourceId: 'djay-d', sourceLabel: 'D', deckIndex: 1, title: 'Song A', artist: null, bpm: null, key: null,
  };
  const deckB = {
    sourceId: 'djay-d', sourceLabel: 'D', deckIndex: 2, title: 'Song B', artist: null, bpm: null, key: null,
  };
  const renamed = { ...deckA, title: 'Song A (Edit)' };

  assert.deepEqual(onAirTransitions([deckA], [deckA]), []);
  const titleChange = onAirTransitions([deckA], [renamed]);
  assert.equal(titleChange.length, 1);
  assert.equal(titleChange[0].deck.title, 'Song A (Edit)');
  assert.deepEqual(titleChange[0].previousOnAir, {
    sourceId: 'djay-d', deckIndex: 1, title: 'Song A',
  });

  const crossfade = onAirTransitions([deckA], [deckB]);
  assert.equal(crossfade.length, 1);
  assert.equal(crossfade[0].deck.deckIndex, 2);
  assert.deepEqual(crossfade[0].previousOnAir, {
    sourceId: 'djay-d', deckIndex: 1, title: 'Song A',
  });
});

test('load on the idle deck does not log; crossfade onto it logs one Art-Net line', () => {
  const { logger, bus, dir } = tempLogger({
    getTimecodeStatus: () => ({
      enabled: true,
      live: true,
      timecode: { display: '01:23:45:12' },
    }),
  });
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'show-night-1' });

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 128,
    beat: 12,
    authoritativeClip: 'Cue',
    tracks: [],
  }));

  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({
      decks: [
        deck({ deckIndex: 1, onAir: true, loaded: { title: 'My Way (Remix)', artist: 'KATSEYE' }, bpm: 128, key: 'e flat' }),
        deck({ deckIndex: 2, onAir: false, playing: false, loaded: { title: 'Holding', artist: null } }),
      ],
    }),
  ]));

  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({
      decks: [
        deck({ deckIndex: 1, onAir: true, loaded: { title: 'My Way (Remix)', artist: 'KATSEYE' }, bpm: 128, key: 'e flat' }),
        deck({
          deckIndex: 2,
          onAir: false,
          playing: true,
          loaded: { title: 'What It Sounds Like (AWAIAN Remix)', artist: 'HUNTR/X' },
          bpm: 124,
          key: 'e minor',
        }),
      ],
    }),
  ]));

  const file = join(dir, 'show-night-1.jsonl');
  const before = readLines(file).filter((row) => row.event === 'deck_on_air');
  assert.equal(before.length, 1);
  assert.equal(before[0].deckIndex, 1);
  assert.equal(before[0].title, 'My Way (Remix)');

  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({
      decks: [
        deck({ deckIndex: 1, onAir: false, playing: false, loaded: { title: 'My Way (Remix)', artist: 'KATSEYE' } }),
        deck({
          deckIndex: 2,
          onAir: true,
          playing: true,
          loaded: { title: 'What It Sounds Like (AWAIAN Remix)', artist: 'HUNTR/X' },
          bpm: 124,
          key: 'e minor',
        }),
      ],
    }),
  ]));

  const lines = readLines(file).filter((row) => row.event === 'deck_on_air');
  assert.equal(lines.length, 2);
  const crossfade = lines[1];
  assert.equal(crossfade.timestamp, '01:23:45:12');
  assert.equal(crossfade.timestampSource, 'artnet');
  assert.equal(crossfade.sourceId, 'djay-d');
  assert.equal(crossfade.sourceLabel, 'D');
  assert.equal(crossfade.deckIndex, 2);
  assert.equal(crossfade.title, 'What It Sounds Like (AWAIAN Remix)');
  assert.equal(crossfade.artist, 'HUNTR/X');
  assert.equal(crossfade.bpm, 124);
  assert.equal(crossfade.key, 'e minor');
  assert.equal(crossfade.tempo, 128);
  assert.equal(crossfade.beat, 12);
  assert.equal(crossfade.simulated, false);
  assert.equal(crossfade.sessionName, 'show-night-1');
  assert.deepEqual(crossfade.previousOnAir, {
    sourceId: 'djay-d',
    deckIndex: 1,
    title: 'My Way (Remix)',
  });

  logger.stop();
});

test('session log off writes nothing; a stale source does not add another line', () => {
  const offDir = mkdtempSync(join(tmpdir(), 'ableview-deck-on-air-'));
  const off = tempLogger({
    config: {
      sessionLog: {
        directory: offDir,
        autoStart: false,
        autoStartWhenSim: false,
        defaultSessionName: 'test',
      },
    },
  });
  off.logger.start();
  off.bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({ decks: [deck({ onAir: true, loaded: { title: 'Already on', artist: null } })] }),
  ]));
  assert.equal(readLines(join(offDir, 'test.jsonl')).filter((row) => row.event === 'deck_on_air').length, 0);
  off.logger.applyPatch({ enabled: true, sessionName: 'test' });
  off.bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({ decks: [deck({ onAir: true, loaded: { title: 'Already on', artist: null } })] }),
  ]));
  assert.equal(readLines(join(offDir, 'test.jsonl')).filter((row) => row.event === 'deck_on_air').length, 0);
  off.bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({ decks: [deck({ onAir: true, loaded: { title: 'Next track', artist: null } })] }),
  ]));
  const afterEnable = readLines(join(offDir, 'test.jsonl')).filter((row) => row.event === 'deck_on_air');
  assert.equal(afterEnable.length, 1);
  assert.equal(afterEnable[0].title, 'Next track');
  off.logger.stop();

  const { logger, bus, dir } = tempLogger();
  logger.start();
  logger.applyPatch({ enabled: true, sessionName: 'test' });
  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({ decks: [deck({ onAir: true, loaded: { title: 'Live', artist: null } })] }),
  ]));
  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({
      stale: true,
      live: false,
      decks: [deck({ onAir: true, loaded: { title: 'After dropout', artist: null } })],
    }),
  ]));
  bus.emit(EVENTS.PROGRAM_DECK_STATE, programState([
    source({ decks: [deck({ onAir: true, loaded: { title: 'Live', artist: null } })] }),
  ]));
  const lines = readLines(join(dir, 'test.jsonl')).filter((row) => row.event === 'deck_on_air');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].title, 'Live');
  logger.stop();
});
