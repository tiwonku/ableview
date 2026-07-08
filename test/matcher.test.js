import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { DEFAULTS } from '../src/config/index.js';
import { normalizeClipName, parseAliases } from '../src/match/normalize.js';
import { matchClip, createMatcher } from '../src/match/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const SHEET_ROWS = [
  {
    rowId: '5',
    data: {
      'Clip Name': 'Song A - Intro',
      Key: 'A minor',
      BPM: '128',
      'Band Notes': 'Count in 4',
      Aliases: 'SA Intro|intro a',
    },
  },
  {
    rowId: '6',
    data: {
      'Clip Name': 'Song A - Drop',
      Key: 'A minor',
      BPM: '128',
      'Band Notes': 'Hit hard',
      Aliases: '',
    },
  },
  {
    rowId: '7',
    data: {
      'Clip Name': 'Song B - Verse',
      Key: 'D major',
      BPM: '100',
      'Band Notes': 'Soft',
      Aliases: 'Song B Verse',
    },
  },
];

function testConfig(overrides = {}) {
  return {
    ...DEFAULTS,
    sheets: {
      ...DEFAULTS.sheets,
      matchColumn: 'Clip Name',
      aliasColumn: 'Aliases',
    },
    match: {
      ...DEFAULTS.match,
      threshold: 0.4,
      ...overrides.match,
    },
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    syncedAt: '2026-07-07T20:12:00.000Z',
    stale: false,
    rows: SHEET_ROWS,
    ...overrides,
  };
}

test('normalizeClipName lowercases, strips punctuation, and version tags', () => {
  const opts = { lowercase: true, stripPunctuation: true, stripVersionTags: true };
  assert.equal(normalizeClipName('Song A - Intro v2', opts), 'song a intro');
  assert.equal(normalizeClipName('Totally Unknown Clip v3', opts), 'totally unknown clip');
  assert.equal(normalizeClipName('Track - alt', opts), 'track');
  assert.equal(normalizeClipName('Track 128bpm', opts), 'track');
});

test('parseAliases splits on pipe and comma', () => {
  assert.deepEqual(parseAliases('a|b, c'), ['a', 'b', 'c']);
  assert.deepEqual(parseAliases(''), []);
});

test('exact clip name matches the correct row', () => {
  const payload = matchClip('Song A - Intro', snapshot(), testConfig());
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '5');
  assert.equal(payload.match.matchedValue, 'Song A - Intro');
  assert.equal(payload.match.viaAlias, false);
  assert.equal(payload.row['Band Notes'], 'Count in 4');
  assert.ok(payload.match.confidence > 0.8);
});

test('normalized variant matches (punctuation + version tag)', () => {
  const payload = matchClip('song a intro v2', snapshot(), testConfig());
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '5');
});

test('alias column match sets viaAlias', () => {
  const payload = matchClip('SA Intro', snapshot(), testConfig());
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '5');
  assert.equal(payload.match.viaAlias, true);
  assert.equal(payload.match.matchedValue, 'SA Intro');
});

test('clip with arrangement suffix matches sheet title via prefix pass', () => {
  const rows = [
    {
      rowId: '144',
      data: {
        'Clip Name': 'Still Night',
        Key: 'Gm',
        BPM: '98',
        Aliases: '',
      },
    },
  ];
  const payload = matchClip(
    'Still Night edit part 2',
    snapshot({ rows }),
    testConfig({ match: { threshold: 0.4 } })
  );
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '144');
  assert.equal(payload.match.matchedValue, 'Still Night');
  assert.equal(payload.match.confidence, 0.9);
});

test('prefix match prefers longest sheet title', () => {
  const rows = [
    {
      rowId: '10',
      data: { 'Clip Name': 'So Bright', Aliases: '' },
    },
    {
      rowId: '11',
      data: { 'Clip Name': 'Bright', Aliases: '' },
    },
  ];
  const payload = matchClip(
    'So Bright edit',
    snapshot({ rows }),
    testConfig({ match: { threshold: 0.4 } })
  );
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '10');
  assert.equal(payload.match.matchedValue, 'So Bright');
});

test('prefix match requires title at start of clip name', () => {
  const rows = [
    {
      rowId: '20',
      data: { 'Clip Name': 'Still Night', Aliases: '' },
    },
  ];
  const payload = matchClip(
    'Intro - Still Night',
    snapshot({ rows }),
    testConfig({ match: { threshold: 0.4 } })
  );
  assert.equal(payload.match.matched, false);
});

test('below-threshold clip returns matched false (NFR-7)', () => {
  const payload = matchClip('Totally Unknown Clip v3', snapshot(), testConfig());
  assert.equal(payload.match.matched, false);
  assert.equal(payload.match.confidence, 0);
  assert.equal(payload.row, undefined);
});

test('strict threshold rejects loose matches', () => {
  const config = testConfig({ match: { threshold: 0.05 } });
  const payload = matchClip('Song Z - Bridge', snapshot(), config);
  assert.equal(payload.match.matched, false);
});

test('null clip returns unmatched payload without row', () => {
  const payload = matchClip(null, snapshot(), testConfig());
  assert.equal(payload.clipName, null);
  assert.equal(payload.match.matched, false);
  assert.equal(payload.row, undefined);
});

test('stale flag passes through from sheet snapshot', () => {
  const payload = matchClip('Song A - Intro', snapshot({ stale: true }), testConfig());
  assert.equal(payload.stale, true);
  assert.equal(payload.syncedAt, '2026-07-07T20:12:00.000Z');
});

test('CuePayload contract keys', () => {
  const payload = matchClip('Song A - Drop', snapshot(), testConfig());
  assert.deepEqual(Object.keys(payload).sort(), [
    'beat',
    'clipName',
    'match',
    'row',
    'simulated',
    'stale',
    'syncedAt',
    'tempo',
  ]);
  assert.deepEqual(Object.keys(payload.match).sort(), [
    'confidence',
    'matched',
    'matchedValue',
    'rowId',
    'viaAlias',
  ]);
});

test('createMatcher emits CuePayload on NowPlaying change', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot(),
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      authoritativeClip: 'Song B - Verse',
      tempo: 100,
    })
  );

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].clipName, 'Song B - Verse');
  assert.equal(payloads[0].match.matched, true);
  assert.equal(payloads[0].match.rowId, '7');
  assert.equal(payloads[0].simulated, true);
  assert.equal(payloads[0].tempo, 100);
});

test('createMatcher dedupes identical NowPlaying events', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot(),
  });

  const event = makeNowPlaying({
    source: SOURCES.SIMULATOR,
    authoritativeClip: 'Song A - Intro',
    tempo: 128,
  });
  bus.emit(EVENTS.NOW_PLAYING, event);
  bus.emit(EVENTS.NOW_PLAYING, event);

  assert.equal(payloads.length, 1);
});

test('createMatcher re-emits when tempo changes for same clip', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot(),
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({ source: SOURCES.ABLETONOSC, authoritativeClip: 'Song A - Intro', tempo: 128 })
  );
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({ source: SOURCES.ABLETONOSC, authoritativeClip: 'Song A - Intro', tempo: 130 })
  );

  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].tempo, 130);
  assert.equal(payloads[1].simulated, false);
});

test('createMatcher re-emits when beat changes for same clip without re-matching', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot(),
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
      beat: 12,
    })
  );
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
      beat: 13,
    })
  );

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].beat, 12);
  assert.equal(payloads[1].beat, 13);
  assert.equal(payloads[0].match.rowId, '5');
  assert.equal(payloads[1].match.rowId, '5');
  assert.equal(payloads[1].match.matchedValue, payloads[0].match.matchedValue);
});
