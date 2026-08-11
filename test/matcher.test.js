import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { DEFAULTS } from '../src/config/index.js';
import { normalizeClipName, parseAliases } from '../src/match/normalize.js';
import { matchClip, matchBestOfTracks, createMatcher } from '../src/match/index.js';

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
  assert.equal(normalizeClipName('HotRox_ DRUMS', opts), 'hotrox');
});

test('normalizeClipName strips ALS bpm prefix without parsing musical keys', () => {
  const opts = { lowercase: true, stripPunctuation: true, stripVersionTags: true };
  assert.equal(
    normalizeClipName('Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO', opts),
    'gazing at the glare'
  );
  assert.equal(
    normalizeClipName('F#m_100bpm_Miracles_24', opts),
    'miracles'
  );
  assert.equal(
    normalizeClipName('Cm_100bpm_GazingAtTheGlare_', opts),
    'gazing at the glare'
  );
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

test('underscore role suffix matches alias stem via prefix', () => {
  const rows = [
    {
      rowId: '70',
      data: {
        'Clip Name': 'Hot Like Rox',
        Aliases: 'HotRox',
      },
    },
  ];
  const payload = matchClip('HotRox_ DRUMS', snapshot({ rows }), testConfig());
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '70');
  assert.equal(payload.match.viaAlias, true);
  assert.equal(payload.match.matchedValue, 'HotRox');
});

test('ALS bpm stem matches Song Title without needing ALS Folder column', () => {
  const rows = [
    {
      rowId: '62',
      data: {
        'Clip Name': 'Gazing At The Glare',
        Aliases: '',
      },
    },
  ];
  const payload = matchClip(
    'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO',
    snapshot({ rows }),
    testConfig({
      sheets: {
        ...DEFAULTS.sheets,
        matchColumn: 'Clip Name',
        aliasColumn: 'Aliases',
        alsFolderColumn: null,
      },
    })
  );
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '62');
  assert.equal(payload.match.matchedValue, 'Gazing At The Glare');
});

test('ALS folder soft key matches Gazing clip without exact folder string', () => {
  const rows = [
    {
      rowId: '62',
      data: {
        'Clip Name': 'Gazing At The Glare',
        Aliases: '',
        'ALS Folder': 'Cm_100bpm_GazingAtTheGlare_',
      },
    },
  ];
  const payload = matchClip(
    'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO',
    snapshot({ rows }),
    testConfig({
      sheets: {
        ...DEFAULTS.sheets,
        matchColumn: 'Clip Name',
        aliasColumn: 'Aliases',
        alsFolderColumn: 'ALS Folder',
      },
    })
  );
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '62');
});

test('bestMatch picks song deck over drums cue track', () => {
  const rows = [
    {
      rowId: '62',
      data: {
        'Clip Name': 'Gazing At The Glare',
        Aliases: '',
        'ALS Folder': 'Cm_100bpm_GazingAtTheGlare_',
      },
    },
  ];
  const config = testConfig({
    sheets: {
      ...DEFAULTS.sheets,
      matchColumn: 'Clip Name',
      aliasColumn: 'Aliases',
      alsFolderColumn: 'ALS Folder',
    },
  });
  const payload = matchBestOfTracks(
    [
      { trackIndex: 11, trackName: 'DECK A', clipName: 'DRUMS 1', slotIndex: 402 },
      { trackIndex: 13, trackName: 'DECK C', clipName: 'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO', slotIndex: 384 },
    ],
    snapshot({ rows }),
    config
  );

  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '62');
  assert.equal(payload.clipName, 'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO');
  const winner = payload.trackMatches.find((t) => t.winner);
  assert.equal(winner?.trackName, 'DECK C');
  const drums = payload.trackMatches.find((t) => t.trackName === 'DECK A');
  assert.equal(drums?.matched, false);
});

test('bestMatch returns no match when two rows tie within confidence gap', () => {
  const rows = [
    { rowId: '1', data: { 'Clip Name': 'Alpha Song', Aliases: '' } },
    { rowId: '2', data: { 'Clip Name': 'Beta Song', Aliases: '' } },
  ];
  const payload = matchBestOfTracks(
    [
      { trackIndex: 0, trackName: 'A', clipName: 'Alpha Song', slotIndex: 0 },
      { trackIndex: 1, trackName: 'B', clipName: 'Beta Song', slotIndex: 0 },
    ],
    snapshot({ rows }),
    testConfig({ match: { threshold: 0.4, minConfidenceGap: 0.5 } })
  );
  assert.equal(payload.match.matched, false);
  assert.equal(payload.clipName, null);
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
    'ingestLive',
    'isPlaying',
    'match',
    'pendingLaunch',
    'row',
    'simulated',
    'stale',
    'syncedAt',
    'tempo',
    'trackMatches',
    'tracks',
  ]);
  assert.deepEqual(payload.tracks, []);
  assert.deepEqual(payload.trackMatches, []);
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
    config: testConfig({ sim: { ...DEFAULTS.sim, enabled: true } }),
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
      tracks: [
        { trackIndex: 0, trackName: 'Cue', clipName: 'Song B - Verse', slotIndex: 2 },
        { trackIndex: 3, trackName: 'Vocals', clipName: null, slotIndex: null },
      ],
    })
  );

  assert.equal(payloads.length, 1);
  assert.equal(payloads[0].clipName, 'Song B - Verse');
  assert.equal(payloads[0].match.matched, true);
  assert.equal(payloads[0].match.rowId, '7');
  assert.equal(payloads[0].simulated, true);
  assert.equal(payloads[0].tempo, 100);
  assert.deepEqual(payloads[0].tracks, [
    { trackIndex: 0, trackName: 'Cue', clipName: 'Song B - Verse', slotIndex: 2 },
    { trackIndex: 3, trackName: 'Vocals', clipName: null, slotIndex: null },
  ]);
});

test('createMatcher rematch clears simulated when sim.enabled is false', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  let simEnabled = true;
  const matcher = createMatcher({
    getConfig: () => testConfig({ sim: { ...DEFAULTS.sim, enabled: simEnabled } }),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot(),
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.SIMULATOR,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
    })
  );
  assert.equal(payloads.at(-1).simulated, true);

  simEnabled = false;
  matcher.rematch();
  assert.equal(payloads.at(-1).simulated, false);
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

test('createMatcher re-emits when isPlaying changes for same clip without re-matching', () => {
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
      isPlaying: true,
    })
  );
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'Song A - Intro',
      tempo: 128,
      isPlaying: false,
    })
  );

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].isPlaying, true);
  assert.equal(payloads[1].isPlaying, false);
  assert.equal(payloads[0].match.rowId, '5');
  assert.equal(payloads[1].match.rowId, '5');
});

test('createMatcher rematches when a watched-track clip changes under bestMatch', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (p) => payloads.push(p));

  const rows = [
    {
      rowId: '62',
      data: {
        'Clip Name': 'Gazing At The Glare',
        Aliases: '',
        'ALS Folder': 'Cm_100bpm_GazingAtTheGlare_',
      },
    },
  ];

  createMatcher({
    config: testConfig({
      ingest: { ...DEFAULTS.ingest, authoritative: { strategy: 'bestMatch', track: null } },
      sheets: {
        ...DEFAULTS.sheets,
        matchColumn: 'Clip Name',
        aliasColumn: 'Aliases',
        alsFolderColumn: 'ALS Folder',
      },
    }),
    bus,
    log: silentLog,
    getSnapshot: () => snapshot({ rows }),
  });

  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'DRUMS 1',
      tempo: 100,
      tracks: [
        { trackIndex: 11, trackName: 'DECK A', clipName: 'DRUMS 1', slotIndex: 0 },
        { trackIndex: 13, trackName: 'DECK C', clipName: null, slotIndex: null },
      ],
    })
  );
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: 'DRUMS 1',
      tempo: 100,
      tracks: [
        { trackIndex: 11, trackName: 'DECK A', clipName: 'DRUMS 1', slotIndex: 0 },
        {
          trackIndex: 13,
          trackName: 'DECK C',
          clipName: 'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO',
          slotIndex: 4,
        },
      ],
    })
  );

  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].match.matched, false);
  assert.equal(payloads[1].match.matched, true);
  assert.equal(payloads[1].match.rowId, '62');
  assert.equal(payloads[1].tracks[1].clipName, 'Cm_100bpm_Gazing_At_The_Glare 8 BAR INTRO');
});
