import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRANGEMENT_PLAYING,
  isArrangementPlaying,
  zipArrangementClips,
  clipAtSongTime,
  applyArrangementClipName,
} from '../src/ingest/arrangement-clip.js';

test('isArrangementPlaying is only -2', () => {
  assert.equal(isArrangementPlaying(ARRANGEMENT_PLAYING), true);
  assert.equal(isArrangementPlaying(-1), false);
  assert.equal(isArrangementPlaying(0), false);
  assert.equal(isArrangementPlaying(null), false);
});

test('zipArrangementClips pairs name / start / length and skips invalid lengths', () => {
  const clips = zipArrangementClips(
    ['Intro', 'Verse', 'Outro'],
    [0, 16, 48],
    [16, 32, 0]
  );
  assert.deepEqual(clips, [
    { name: 'Intro', startTime: 0, length: 16 },
    { name: 'Verse', startTime: 16, length: 32 },
  ]);
});

test('zipArrangementClips allows names to arrive later', () => {
  const clips = zipArrangementClips([], [0, 8], [8, 8]);
  assert.deepEqual(clips, [
    { name: '', startTime: 0, length: 8 },
    { name: '', startTime: 8, length: 8 },
  ]);
});

test('clipAtSongTime uses half-open ranges and prefers later overlap', () => {
  const clips = [
    { name: 'Intro', startTime: 0, length: 16 },
    { name: 'Verse', startTime: 16, length: 32 },
    { name: 'Overlap', startTime: 20, length: 8 },
  ];
  assert.equal(clipAtSongTime(clips, 0)?.name, 'Intro');
  assert.equal(clipAtSongTime(clips, 15.9)?.name, 'Intro');
  assert.equal(clipAtSongTime(clips, 16)?.name, 'Verse');
  assert.equal(clipAtSongTime(clips, 22)?.name, 'Overlap');
  assert.equal(clipAtSongTime(clips, 48), null);
  assert.equal(clipAtSongTime(clips, null), null);
});

test('applyArrangementClipName sets the clip under the playhead', () => {
  const state = {
    playingSlotIndex: ARRANGEMENT_PLAYING,
    arrangementClips: [
      { name: 'Still Night', startTime: 0, length: 32 },
      { name: 'Yellow Bird', startTime: 32, length: 16 },
    ],
    arrangementClipName: null,
  };
  assert.equal(applyArrangementClipName(state, 8), true);
  assert.equal(state.arrangementClipName, 'Still Night');
  assert.equal(applyArrangementClipName(state, 8), false);
  assert.equal(applyArrangementClipName(state, 40), true);
  assert.equal(state.arrangementClipName, 'Yellow Bird');
});

test('applyArrangementClipName clears on session / stop and treats gaps as null', () => {
  const state = {
    playingSlotIndex: ARRANGEMENT_PLAYING,
    arrangementClips: [{ name: 'Still Night', startTime: 0, length: 16 }],
    arrangementClipName: 'Still Night',
  };
  assert.equal(applyArrangementClipName(state, 20), true);
  assert.equal(state.arrangementClipName, null);

  state.playingSlotIndex = 2;
  state.arrangementClipName = 'Still Night';
  assert.equal(applyArrangementClipName(state, 8), true);
  assert.equal(state.arrangementClipName, null);
});
