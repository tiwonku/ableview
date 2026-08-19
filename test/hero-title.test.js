import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeroDisplay,
  resolveMatchedTitle,
  hasArrangementPlayback,
  isArrangementTrack,
  canStartCreate,
  resolveCreateClipName,
} from '../public/shared/playing-clips-strip.js';

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
  assert.equal(hero.empty, false);
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
