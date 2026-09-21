import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeroDisplay,
  resolveMatchedTitle,
  hasArrangementPlayback,
  isArrangementTrack,
  canStartCreate,
  resolveCreateClipName,
  resolveCuePane,
  lastPanePayload,
  hasLastMatchedRow,
  normalizeCuePane,
  resolveStoredCuePane,
  readStoredCuePane,
  writeStoredCuePane,
  CUE_PANE_STORAGE_KEY,
} from '../public/shared/playing-clips-strip.js';
import { getFieldValue } from '../public/shared/field-display.js';

const yellowBirdPayload = {
  clipName: 'E_87bpm_Yellow bird_SZ24',
  match: {
    matched: true,
    confidence: 0.9,
    rowId: '87',
    matchedValue: 'E_87bpm_Yellow bird_SZ24',
    viaAlias: true,
  },
  row: {
    'Song Title': 'Yellow Bird',
    Key: 'E',
    'Relative Key': 'C#m',
    'ALS Folder': 'E_87bpm_Yellow bird_SZ24',
  },
};

test('resolveMatchedTitle prefers sheet matchColumn over ALS folder matchedValue', () => {
  assert.equal(resolveMatchedTitle(yellowBirdPayload, 'Song Title'), 'Yellow Bird');
});

test('resolveMatchedTitle falls back to matchedValue without matchColumn', () => {
  assert.equal(resolveMatchedTitle(yellowBirdPayload, null), 'E_87bpm_Yellow bird_SZ24');
});

test('resolveHeroDisplay uses sheet title on a read-only operator view', () => {
  const hero = resolveHeroDisplay(yellowBirdPayload, 'Song Title');
  assert.equal(hero.showHero, true);
  assert.equal(hero.text, 'Yellow Bird');
  assert.equal(hero.empty, false);
});

test('resolveHeroDisplay shows No Match as operator hero when clips play unmatched', () => {
  const hero = resolveHeroDisplay({
    match: { matched: false },
    tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'Drums InTheName_DRMS' }],
  }, 'Song Title', { noMatchHero: true });
  assert.equal(hero.showHero, true);
  assert.equal(hero.text, 'No Match');
  assert.equal(hero.noMatch, true);
  assert.equal(hero.lastMatched, undefined);
  assert.equal(hero.empty, false);
});

test('resolveHeroDisplay keeps No Match as hero on Current when lastMatched exists', () => {
  const hero = resolveHeroDisplay({
    match: { matched: false },
    tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'INTRO' }],
    lastMatched: { title: 'Yellow Bird', rowId: '87' },
  }, 'Song Title', { noMatchHero: true });
  assert.equal(hero.showHero, true);
  assert.equal(hero.text, 'No Match');
  assert.equal(hero.noMatch, true);
  assert.equal(hero.lastMatched, undefined);
  assert.equal(hero.empty, false);
});

test('resolveHeroDisplay shows last matched title as operator hero on Last pane', () => {
  const hero = resolveHeroDisplay({
    match: { matched: false },
    tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'INTRO' }],
    lastMatched: { title: 'Yellow Bird', rowId: '87' },
  }, 'Song Title', { noMatchHero: true, cuePane: 'last' });
  assert.equal(hero.showHero, true);
  assert.equal(hero.text, 'Yellow Bird');
  assert.equal(hero.noMatch, true);
  assert.equal(hero.lastMatched, true);
  assert.equal(hero.empty, false);
});

test('resolveHeroDisplay prefers live match over lastMatched', () => {
  const hero = resolveHeroDisplay({
    ...yellowBirdPayload,
    lastMatched: { title: 'Older Song' },
  }, 'Song Title', { noMatchHero: true });
  assert.equal(hero.text, 'Yellow Bird');
  assert.equal(hero.noMatch, undefined);
  assert.equal(hero.lastMatched, undefined);
});

test('resolveHeroDisplay marks a pinned match', () => {
  const hero = resolveHeroDisplay({
    ...yellowBirdPayload,
    match: { ...yellowBirdPayload.match, viaOverride: true },
  }, 'Song Title', { noMatchHero: true });
  assert.equal(hero.text, 'Yellow Bird');
  assert.equal(hero.pinned, true);
  assert.equal(hero.noMatch, undefined);
});

test('resolveHeroDisplay hides admin hero when clips play unmatched', () => {
  const hero = resolveHeroDisplay({
    match: { matched: false },
    tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'Drums InTheName_DRMS' }],
  }, 'Song Title');
  assert.equal(hero.showHero, false);
});

test('hasArrangementPlayback is true when any watched track is from arrangement', () => {
  assert.equal(isArrangementTrack({ source: 'arrangement' }), true);
  assert.equal(isArrangementTrack({ source: 'session' }), false);
  assert.equal(hasArrangementPlayback({
    tracks: [
      { trackIndex: 0, trackName: 'Cue', clipName: 'Still Night', source: 'session' },
      { trackIndex: 1, trackName: 'DECK A', clipName: 'Drums', source: 'arrangement' },
    ],
  }), true);
  assert.equal(hasArrangementPlayback({
    tracks: [
      { trackIndex: 0, trackName: 'Cue', clipName: 'Still Night', source: 'session' },
    ],
  }), false);
  assert.equal(hasArrangementPlayback({ tracks: [] }), false);
});

const scenePayload = {
  clipName: 'Mickman INTRO',
  match: {
    matched: true,
    confidence: 0.57,
    rowId: '12',
    matchedValue: 'Spaceman Intro',
  },
  tracks: [
    { trackIndex: 12, trackName: 'DECK B', clipName: 'Mickman INTRO' },
    {
      trackIndex: 13,
      trackName: 'DECK C',
      clipName: 'Funnel Of Love_gaudiolab_vocal_high_quality (Freeze)',
    },
  ],
};

test('canStartCreate blocks generic create when another clip already matched', () => {
  assert.equal(canStartCreate(scenePayload), false);
  assert.equal(canStartCreate(scenePayload, null), false);
});

test('canStartCreate allows per-deck create for an unmatched clip while another deck won', () => {
  const funnel = 'Funnel Of Love_gaudiolab_vocal_high_quality (Freeze)';
  assert.equal(canStartCreate(scenePayload, funnel), true);
  assert.equal(resolveCreateClipName(scenePayload, funnel), funnel);
});

test('canStartCreate ignores click-event objects passed as the override', () => {
  assert.equal(canStartCreate(scenePayload, { type: 'click' }), false);
  assert.equal(resolveCreateClipName(scenePayload, { type: 'click' }), 'Mickman INTRO');
});

test('canStartCreate allows generic create when nothing has matched', () => {
  const unmatched = {
    clipName: 'Funnel Of Love',
    match: { matched: false },
    tracks: [{ trackIndex: 13, trackName: 'DECK C', clipName: 'Funnel Of Love' }],
  };
  assert.equal(canStartCreate(unmatched), true);
  assert.equal(resolveCreateClipName(unmatched), 'Funnel Of Love');
});

const unmatchedWithLast = {
  match: { matched: false },
  tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'INTRO' }],
  lastMatched: {
    title: 'Yellow Bird',
    rowId: '87',
    row: { 'Song Title': 'Yellow Bird', BPM: '87', 'Lighting Notes': 'Warm wash' },
  },
};

test('hasLastMatchedRow requires a row object', () => {
  assert.equal(hasLastMatchedRow(unmatchedWithLast), true);
  assert.equal(hasLastMatchedRow({ lastMatched: { title: 'Yellow Bird', rowId: '87' } }), false);
  assert.equal(hasLastMatchedRow({ match: { matched: false } }), false);
});

test('resolveCuePane defaults to current during no-match when a previous row exists', () => {
  assert.equal(resolveCuePane(unmatchedWithLast), 'current');
  assert.equal(resolveCuePane(unmatchedWithLast, 'last'), 'last');
  assert.equal(resolveCuePane(unmatchedWithLast, 'current'), 'current');
  assert.equal(resolveCuePane(unmatchedWithLast, 'last', { busy: true }), null);
  assert.equal(resolveCuePane(yellowBirdPayload), null);
  assert.equal(resolveCuePane({
    match: { matched: false },
    tracks: [{ trackIndex: 1, trackName: 'DECK A', clipName: 'INTRO' }],
  }), null);
});

test('cue pane preference persists per machine and defaults to current', () => {
  const store = new Map();
  const storage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
  };
  assert.equal(normalizeCuePane('nope'), null);
  assert.equal(resolveStoredCuePane(null), 'current');
  assert.equal(resolveStoredCuePane('last'), 'last');
  assert.equal(readStoredCuePane(storage), null);
  writeStoredCuePane('last', storage);
  assert.equal(store.get(CUE_PANE_STORAGE_KEY), 'last');
  assert.equal(readStoredCuePane(storage), 'last');
  writeStoredCuePane('bogus', storage);
  assert.equal(readStoredCuePane(storage), 'last');
});

test('lastPanePayload exposes lastMatched.row without treating it as a live match', () => {
  const display = lastPanePayload(unmatchedWithLast);
  assert.equal(display.match.matched, false);
  assert.equal(getFieldValue({ column: 'BPM' }, unmatchedWithLast), null);
  assert.equal(getFieldValue({ column: 'BPM' }, display), '87');
  assert.equal(getFieldValue({ column: 'Lighting Notes' }, display), 'Warm wash');
});

test('operator Last/Current toggle is wired in view-render and ws-client', () => {
  const viewSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)),
    'utf8',
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  assert.match(viewSrc, /cue-pane-toggle/);
  assert.match(viewSrc, /no-match-panel--last-fields/);
  assert.match(viewSrc, /resolveCuePane/);
  assert.match(viewSrc, /lastPanePayload/);
  assert.match(clientSrc, /resolveStoredCuePane\(readStoredCuePane\(\)\)/);
  assert.match(clientSrc, /writeStoredCuePane/);
  assert.match(clientSrc, /onCuePaneChange: setCuePane/);
  assert.doesNotMatch(clientSrc, /cuePane = 'last'/);
});

test('operator pin cue is wired in view-render and ws-client', () => {
  const viewSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)),
    'utf8',
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  assert.match(viewSrc, /Pin this cue/);
  assert.match(viewSrc, /Pin a different cue/);
  assert.match(viewSrc, /Change cue/);
  assert.match(viewSrc, /Clear pin/);
  assert.match(viewSrc, /renderPinPanel/);
  assert.match(clientSrc, /\/api\/match\/override/);
  assert.match(clientSrc, /function startPin/);
  assert.match(clientSrc, /mergePinResults/);
  assert.match(clientSrc, /applyPinResults\(''\)/);
});
