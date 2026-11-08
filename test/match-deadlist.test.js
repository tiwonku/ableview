import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';
import { normalizeClipName } from '../src/match/normalize.js';
import { createDeadlistStore } from '../src/match/deadlist.js';
import { createMatcher, matchBestOfTracks, resolveClipMatch } from '../src/match/index.js';
import { createViewServer } from '../src/server/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const SHEET_ROWS = [
  {
    rowId: '5',
    data: { 'Clip Name': 'Song A - Intro', Aliases: 'SA Intro' },
  },
  {
    rowId: '7',
    data: { 'Clip Name': 'Song B - Verse', Aliases: '' },
  },
];

function testConfig(match = {}) {
  return {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 30 },
    sheets: {
      ...DEFAULTS.sheets,
      matchColumn: 'Clip Name',
      aliasColumn: 'Aliases',
    },
    match: { ...DEFAULTS.match, threshold: 0.4, ...match },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      admin: { title: 'Admin', system: true },
    },
  };
}

function snapshot() {
  return {
    syncedAt: '2026-07-07T20:12:00.000Z',
    stale: false,
    rows: SHEET_ROWS,
  };
}

function norm(name) {
  return normalizeClipName(name, DEFAULTS.match.normalize);
}

function emitClip(bus, clipName, extraTracks = []) {
  const tracks = [
    { trackIndex: 0, trackName: 'Cue', clipName, slotIndex: 1 },
    ...extraTracks,
  ];
  bus.emit(
    EVENTS.NOW_PLAYING,
    makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      authoritativeClip: clipName,
      tempo: 128,
      tracks,
    }),
  );
}

test('resolveClipMatch skips a deadlisted clip before prefix and fuse', () => {
  const open = resolveClipMatch('Song A - Intor', snapshot(), testConfig());
  assert.equal(open.match.matched, true);
  assert.equal(open.match.rowId, '5');

  const blocked = resolveClipMatch('Song A - Intor', snapshot(), testConfig({
    deadlistedNorms: [norm('Song A - Intor')],
  }));
  assert.equal(blocked.match.matched, false);
  assert.equal(blocked.deadlisted, true);
  assert.equal(blocked.row, null);

  const versioned = resolveClipMatch('Song A - Intro v2', snapshot(), testConfig({
    deadlistedNorms: [norm('Song A - Intro v2')],
  }));
  assert.equal(versioned.deadlisted, true);
  assert.equal(versioned.match.matched, false);
});

test('matchBestOfTracks lets the other clip win when one name is deadlisted', () => {
  const tracks = [
    { trackIndex: 0, trackName: 'Cue', clipName: 'Song A - Intro' },
    { trackIndex: 1, trackName: 'DECK B', clipName: 'Song B - Verse' },
  ];
  const tie = matchBestOfTracks(tracks, snapshot(), testConfig());
  assert.equal(tie.match.matched, false);

  const payload = matchBestOfTracks(tracks, snapshot(), testConfig({
    deadlistedNorms: [norm('Song A - Intro')],
  }));
  assert.equal(payload.match.matched, true);
  assert.equal(payload.match.rowId, '7');
  assert.equal(payload.clipName, 'Song B - Verse');
  const skipped = payload.trackMatches.find((tm) => tm.clipName === 'Song A - Intro');
  assert.equal(skipped.excluded, 'deadlist');
  assert.equal(skipped.matched, false);
  assert.equal(skipped.winner, false);
});

test('a pin still wins after a deadlist, and clearing the pin keeps the clip unmatched', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (payload) => payloads.push(payload));
  const matcher = createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: snapshot,
  });

  emitClip(bus, 'Song A - Intro');
  assert.equal(payloads.at(-1).match.rowId, '5');

  matcher.deadlistClip('Song A - Intro');
  assert.equal(payloads.at(-1).match.matched, false);
  assert.equal(payloads.at(-1).trackMatches[0].excluded, 'deadlist');
  assert.equal(matcher.listDeadlist()[0].norm, norm('Song A - Intro'));

  matcher.setOverride('7');
  assert.equal(payloads.at(-1).match.viaOverride, true);
  assert.equal(payloads.at(-1).match.rowId, '7');

  matcher.clearOverride();
  assert.equal(payloads.at(-1).match.matched, false);
  assert.equal(payloads.at(-1).match.viaOverride, undefined);
  assert.equal(matcher.listDeadlist().length, 1);

  matcher.allowClip('Song A - Intro');
  assert.equal(payloads.at(-1).match.matched, true);
  assert.equal(payloads.at(-1).match.rowId, '5');
  assert.equal(matcher.listDeadlist().length, 0);
});

test('deadlisting the live clip drops a pin; deadlisting a different clip does not', () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (payload) => payloads.push(payload));
  const matcher = createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: snapshot,
  });

  emitClip(bus, 'Song A - Intro');
  matcher.setOverride('7');
  assert.equal(payloads.at(-1).match.viaOverride, true);
  assert.equal(payloads.at(-1).clipName, 'Song A - Intro');

  matcher.deadlistClip('Song B - Verse');
  assert.equal(payloads.at(-1).match.viaOverride, true);
  assert.equal(payloads.at(-1).match.rowId, '7');

  matcher.deadlistClip('Song A - Intro');
  assert.equal(payloads.at(-1).match.viaOverride, undefined);
  assert.equal(payloads.at(-1).match.matched, false);
  assert.equal(matcher.getOverride().rowId, null);
});

test('deadlist store persists normalized names and reloads them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-deadlist-'));
  const filePath = join(dir, 'match-deadlist.json');
  try {
    const store = createDeadlistStore({ filePath, log: silentLog });
    store.add('Song A - Intro v2', DEFAULTS.match.normalize);
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8'));
    assert.equal(onDisk.clips[0].norm, norm('Song A - Intro v2'));
    assert.equal(onDisk.clips[0].clipName, 'Song A - Intro v2');

    const again = createDeadlistStore({ filePath, log: silentLog });
    assert.equal(again.has(norm('Song A - Intro v2')), true);
    again.remove(norm('Song A - Intro v2'));
    assert.deepEqual(again.list(), []);

    writeFileSync(filePath, '{not json', 'utf8');
    const broken = createDeadlistStore({ filePath, log: silentLog });
    assert.deepEqual(broken.list(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('POST /api/match/deadlist blocks a clip and DELETE allows it', async () => {
  const bus = createBus();
  const payloads = [];
  bus.on(EVENTS.CUE_PAYLOAD, (payload) => payloads.push(payload));
  const deadlist = createDeadlistStore();
  const matcher = createMatcher({
    config: testConfig(),
    bus,
    log: silentLog,
    getSnapshot: snapshot,
    deadlist,
  });
  const server = await createViewServer({
    config: testConfig(),
    bus,
    log: silentLog,
    matchActions: {
      setOverride: (rowId) => matcher.setOverride(rowId),
      clearOverride: () => matcher.clearOverride(),
      listDeadlist: () => matcher.listDeadlist(),
      addDeadlist: (clipName) => matcher.deadlistClip(clipName),
      removeDeadlist: (normId) => matcher.allowClip(normId),
    },
    deadlistStore: deadlist,
  });

  emitClip(bus, 'Song A - Intro');
  const base = `http://127.0.0.1:${server.port}`;

  const missing = await fetch(`${base}/api/match/deadlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(missing.status, 400);

  const added = await fetch(`${base}/api/match/deadlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clipName: 'Song A - Intro' }),
  });
  assert.equal(added.status, 200);
  const addedBody = await added.json();
  assert.equal(addedBody.ok, true);
  assert.equal(addedBody.clips.length, 1);
  assert.equal(payloads.at(-1).match.matched, false);

  const listed = await fetch(`${base}/api/match/deadlist`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).clips[0].norm, norm('Song A - Intro'));

  const removed = await fetch(`${base}/api/match/deadlist`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ norm: norm('Song A - Intro') }),
  });
  assert.equal(removed.status, 200);
  assert.equal(payloads.at(-1).match.matched, true);
  assert.equal(payloads.at(-1).match.rowId, '5');

  const gone = await fetch(`${base}/api/match/deadlist`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ norm: 'missing clip' }),
  });
  assert.equal(gone.status, 400);

  await server.stop();
});

test('validateConfig rejects a blank match.deadlistFile', () => {
  const cfg = structuredClone(DEFAULTS);
  cfg.ingest.authoritative.track = 'Cue';
  cfg.server.httpPort = 8080;
  cfg.views = { admin: { title: 'Admin', system: true, fields: [] } };
  cfg.secrets = { googleServiceAccountKeyPath: './secrets/x.json', sheetId: 'abc' };
  cfg.match.deadlistFile = '   ';
  assert.throws(() => validateConfig(cfg), /deadlistFile/);
});

test("Don't match and Allow are wired on the hero, chips, and session grid", () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const viewSrc = readFileSync(join(root, 'public/shared/view-render.js'), 'utf8');
  const stripSrc = readFileSync(join(root, 'public/shared/playing-clips-strip.js'), 'utf8');
  const sessionSrc = readFileSync(join(root, 'public/shared/session-tracks.js'), 'utf8');
  const clientSrc = readFileSync(join(root, 'public/shared/ws-client.js'), 'utf8');
  assert.match(viewSrc, /Don't match/);
  assert.match(viewSrc, /onDeadlistClip/);
  assert.match(viewSrc, /mountDeadlist/);
  assert.match(stripSrc, /playing-clip-chip-deadlist-btn/);
  assert.match(stripSrc, /playing-clip-chip-allow-btn/);
  assert.match(sessionSrc, /session-track-deadlist-btn/);
  assert.match(sessionSrc, /session-track-allow-btn/);
  assert.match(clientSrc, /\/api\/match\/deadlist/);
  assert.match(clientSrc, /onDeadlistClip: onDeadlist/);
  assert.match(clientSrc, /onAllowClip: onAllow/);
  assert.match(clientSrc, /lastDeadlist != null/);
});
