import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionEdl,
  framesToTimecode,
  sessionEdlDrafts,
  timecodeToFrames,
} from '../public/shared/edl-markers.js';
import { summarizeLines } from '../src/session-log/archive.js';

const clock30 = { rateId: '30', dropFrame: false, durations: false };

function line(record) {
  return JSON.stringify(record);
}

function match({ title, clip = title, at, loggedAt, matched = true, pending = false, matchedValue = null }) {
  return line({
    timestamp: at,
    timestampSource: 'clock',
    loggedAt,
    event: 'match',
    clipName: clip,
    match: { matched, matchedValue: matchedValue ?? title },
    pendingLaunch: pending,
    row: title ? { 'Song Title': title } : {},
  });
}

function moment({ kind, who, note = null, at, loggedAt }) {
  return line({
    timestamp: at,
    timestampSource: 'clock',
    loggedAt,
    event: 'moment',
    kind,
    who,
    note,
  });
}

test('frames round-trip 30 fps non-drop and drop-frame', () => {
  assert.equal(framesToTimecode(0, 30, false), '00:00:00:00');
  assert.equal(framesToTimecode(30, 30, false), '00:00:01:00');
  assert.equal(framesToTimecode(1800, 30, true), '00:01:00;02');
  assert.equal(timecodeToFrames('00:01:00;02', 30, true), 1800);
  assert.equal(timecodeToFrames('00:01:00;00', 30, true), null);
});

test('collapsed songs ignore clip changes inside the same title', () => {
  const summary = summarizeLines([
    match({
      title: 'Trip Thru Time',
      clip: 'TTT ARP DROP',
      matchedValue: 'TTT',
      at: '19:49:57:00',
      loggedAt: '2026-09-19T01:49:57.682Z',
    }),
    match({
      title: 'Trip Thru Time',
      clip: 'TTT VERSE',
      matchedValue: 'TTT',
      at: '19:52:00:00',
      loggedAt: '2026-09-19T01:52:00.000Z',
    }),
    match({
      title: '',
      clip: 'NOISE',
      matchedValue: '',
      matched: false,
      at: '19:53:00:00',
      loggedAt: '2026-09-19T01:53:00.000Z',
    }),
    match({
      title: 'Trip Thru Time',
      clip: 'TTT OUTRO',
      at: '19:54:00:00',
      loggedAt: '2026-09-19T01:54:00.000Z',
    }),
    match({
      title: 'Wake Up',
      clip: 'WAKE',
      pending: true,
      at: '19:55:00:00',
      loggedAt: '2026-09-19T01:55:00.000Z',
    }),
    match({
      title: 'Wake Up',
      clip: 'WAKE',
      at: '19:55:37:00',
      loggedAt: '2026-09-19T01:55:37.000Z',
    }),
  ]);
  assert.deepEqual(summary.songs.map((song) => song.title), ['Trip Thru Time', 'Wake Up']);
  assert.equal(summary.songs[0].timestamp, '19:49:57:00');
  assert.equal(summary.songs[1].timestamp, '19:55:37:00');
});

test('EDL writes one-frame markers and keeps note text in front of the color', () => {
  const summary = summarizeLines([
    match({ title: 'Wake Up', at: '19:49:57:00', loggedAt: '2026-09-19T01:49:57.000Z' }),
    moment({ kind: 'dope', who: 'Derek', at: '19:55:37:00', loggedAt: '2026-09-19T01:55:37.000Z' }),
    moment({
      kind: 'typed',
      who: 'setlist',
      note: 'delay for crystal cam',
      at: '20:03:06:00',
      loggedAt: '2026-09-19T02:03:06.000Z',
    }),
    moment({
      kind: 'typed',
      who: 'lights',
      note: 'look | left',
      at: '20:04:00:00',
      loggedAt: '2026-09-19T02:04:00.000Z',
    }),
  ]);
  const songsOnly = buildSessionEdl({
    songs: summary.songs,
    moments: summary.moments,
    includeSongs: true,
    includeDopes: true,
    includeNotes: false,
    settings: clock30,
    sessionName: 'YD_N1',
  });
  assert.equal(songsOnly.ok, true);
  assert.equal(songsOnly.songs, 1);
  assert.equal(songsOnly.dopes, 1);
  assert.equal(songsOnly.notes, 0);
  assert.match(songsOnly.text, /^TITLE: YD_N1\nFCM: NON-DROP FRAME\n/);
  assert.match(songsOnly.text, /19:49:57:00 19:49:57:01 19:49:57:00 19:49:57:01/);
  assert.match(songsOnly.text, / \|C:ResolveColorGreen \|M:Wake Up \|D:1/);
  assert.match(songsOnly.text, / \|C:ResolveColorYellow \|M:Derek \|D:1/);
  assert.doesNotMatch(songsOnly.text, /crystal/);

  const withNotes = buildSessionEdl({
    songs: summary.songs,
    moments: summary.moments,
    includeSongs: false,
    includeDopes: false,
    includeNotes: true,
    noteTaker: 'lights',
    settings: clock30,
    sessionName: 'YD_N1',
  });
  assert.equal(withNotes.notes, 1);
  assert.match(withNotes.text, /look left \|C:ResolveColorBlue \|M:lights \|D:1/);
});

test('a blank presser is named Dope', () => {
  const built = buildSessionEdl({
    songs: [],
    moments: [{ kind: 'dope', who: '  ', note: null, timestamp: '20:00:00:00', loggedAt: '2026-09-19T02:00:00.000Z' }],
    includeSongs: false,
    includeDopes: true,
    includeNotes: false,
    settings: clock30,
  });
  assert.equal(built.ok, true);
  assert.match(built.text, /\|M:Dope \|D:1/);
  assert.match(built.text, /^TITLE: Show markers\n/);
});

test('durations run a song until the next song, including across midnight', () => {
  const summary = summarizeLines([
    match({ title: 'Wake Up', at: '23:50:00:00', loggedAt: '2026-09-19T04:50:00.000Z' }),
    moment({ kind: 'dope', who: 'Derek', at: '23:55:00:00', loggedAt: '2026-09-19T04:55:00.000Z' }),
    match({ title: 'Closer', at: '00:10:00:00', loggedAt: '2026-09-19T05:10:00.000Z' }),
  ]);
  const built = buildSessionEdl({
    songs: summary.songs,
    moments: summary.moments,
    includeSongs: true,
    includeDopes: true,
    includeNotes: false,
    settings: { ...clock30, durations: true },
    sessionName: 'night',
  });
  assert.equal(built.ok, true);
  assert.match(built.text, /23:50:00:00 00:10:00:00 23:50:00:00 00:10:00:00/);
  assert.match(built.text, /\|M:Wake Up \|D:36000/);
  assert.match(built.text, /\|M:Derek \|D:1/);
  const drafts = sessionEdlDrafts({
    songs: summary.songs,
    moments: summary.moments,
    includeSongs: true,
    includeDopes: true,
    rateId: '30',
  });
  assert.equal(drafts[0].kind, 'song');
  assert.equal(drafts[1].kind, 'dope');
  assert.equal(drafts[2].name, 'Closer');
});

test('drop-frame export keeps a drop-frame session stamp', () => {
  const built = buildSessionEdl({
    songs: [{ title: 'Wake Up', timestamp: '00:01:00;02', loggedAt: '2026-09-19T04:01:00.000Z' }],
    moments: [],
    includeSongs: true,
    includeDopes: false,
    includeNotes: false,
    settings: { rateId: '29.97', dropFrame: true, durations: false },
    sessionName: 'df',
  });
  assert.equal(built.ok, true);
  assert.match(built.text, /FCM: DROP FRAME/);
  assert.match(built.text, /00:01:00;02 00:01:00;03/);
});

test('nothing to export when every include flag is off', () => {
  const built = buildSessionEdl({
    songs: [{ title: 'Wake Up', timestamp: '00:00:01:00', loggedAt: '2026-09-19T00:00:01.000Z' }],
    moments: [],
    includeSongs: false,
    includeDopes: false,
    includeNotes: false,
    settings: clock30,
  });
  assert.equal(built.ok, false);
  assert.equal(built.error, 'Nothing to export.');
});
