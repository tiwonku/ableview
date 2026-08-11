import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySlotChanges,
  launchLogKey,
  makeSceneInfo,
  sceneFromNowPlayingTracks,
} from '../src/ingest/scene-launch.js';

test('classifySlotChanges: multi-track same slot is scene launch', () => {
  const prev = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 0, firedSlotIndex: -1 },
    { trackIndex: 1, trackName: 'B', playingSlotIndex: 1, firedSlotIndex: -1 },
  ];
  const next = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 0, firedSlotIndex: 4 },
    { trackIndex: 1, trackName: 'B', playingSlotIndex: 1, firedSlotIndex: 4 },
  ];
  const launch = classifySlotChanges(prev, next);
  assert.equal(launch?.launchType, 'scene');
  assert.equal(launch?.index, 4);
  assert.equal(launch?.pending, true);
});

test('classifySlotChanges: single track is clip launch', () => {
  const prev = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 0, firedSlotIndex: -1 },
    { trackIndex: 1, trackName: 'B', playingSlotIndex: 1, firedSlotIndex: -1 },
  ];
  const next = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 0, firedSlotIndex: -1 },
    { trackIndex: 1, trackName: 'B', playingSlotIndex: 1, firedSlotIndex: 7 },
  ];
  const launch = classifySlotChanges(prev, next);
  assert.equal(launch?.launchType, 'clip');
  assert.equal(launch?.index, 7);
  assert.equal(launch?.trackName, 'B');
});

test('classifySlotChanges: sparse scene uses selected scene index', () => {
  const prev = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 2, firedSlotIndex: -1 },
  ];
  const next = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 2, firedSlotIndex: 5 },
  ];
  const launch = classifySlotChanges(prev, next, { selectedSceneIndex: 5 });
  assert.equal(launch?.launchType, 'scene');
  assert.equal(launch?.index, 5);
});

test('classifySlotChanges: sparse scene uses is_triggered hint', () => {
  const prev = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 2, firedSlotIndex: -1 },
  ];
  const next = [
    { trackIndex: 0, trackName: 'A', playingSlotIndex: 2, firedSlotIndex: 5 },
  ];
  const launch = classifySlotChanges(prev, next, { sceneTriggeredIndex: 5 });
  assert.equal(launch?.launchType, 'scene');
});

test('launchLogKey uses launchId for dedupe', () => {
  assert.equal(launchLogKey(makeSceneInfo({ launchType: 'scene', launchId: 3 })), '3');
  assert.equal(launchLogKey(makeSceneInfo({ launchType: 'clip', launchId: null })), null);
});

test('sceneFromNowPlayingTracks groups active decks', () => {
  const scene = sceneFromNowPlayingTracks([
    { trackIndex: 0, trackName: 'A', clipName: 'X', slotIndex: 3 },
    { trackIndex: 1, trackName: 'B', clipName: 'Y', slotIndex: 3 },
  ], { pendingLaunch: true });
  assert.equal(scene.launchType, 'scene');
  assert.equal(scene.index, 3);
  assert.equal(scene.pending, true);
});
