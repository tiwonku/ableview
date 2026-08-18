import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHeroDisplay,
  resolveMatchedTitle,
  hasArrangementPlayback,
  isArrangementTrack,
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
