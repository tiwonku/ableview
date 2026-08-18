import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTHING_PLAYING,
  isPendingLaunch,
  isValidSlot,
  resolveAuthoritativeClip,
  resolveAuthoritativeClipWithLatch,
} from '../src/ingest/authoritative-clip.js';

function track(overrides) {
  return {
    playingSlotIndex: null,
    playingClipName: null,
    firedSlotIndex: null,
    firedClipName: null,
    latchedClipName: null,
    latchedSlotIndex: null,
    ...overrides,
  };
}

test('isValidSlot rejects stopped and empty slots', () => {
  assert.equal(isValidSlot(NOTHING_PLAYING), false);
  assert.equal(isValidSlot(-2), false);
  assert.equal(isValidSlot(0), true);
  assert.equal(isValidSlot(3), true);
});

test('isPendingLaunch when fired differs from playing', () => {
  assert.equal(isPendingLaunch(0, 1), true);
  assert.equal(isPendingLaunch(NOTHING_PLAYING, 0), true);
  assert.equal(isPendingLaunch(1, 1), false);
  assert.equal(isPendingLaunch(NOTHING_PLAYING, NOTHING_PLAYING), false);
});

test('pending launch uses fired clip name', () => {
  const state = track({
    playingSlotIndex: 0,
    playingClipName: 'Song A',
    firedSlotIndex: 1,
    firedClipName: 'Song B',
  });
  assert.equal(resolveAuthoritativeClip(state), 'Song B');
});

test('steady state uses playing clip when fired matches or clears', () => {
  const playing = track({
    playingSlotIndex: 1,
    playingClipName: 'Song B',
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
  });
  assert.equal(resolveAuthoritativeClip(playing), 'Song B');

  const same = track({
    playingSlotIndex: 1,
    playingClipName: 'Song B',
    firedSlotIndex: 1,
    firedClipName: 'Song B',
  });
  assert.equal(resolveAuthoritativeClip(same), 'Song B');
});

test('fire into empty playing slot uses fired clip', () => {
  const state = track({
    playingSlotIndex: NOTHING_PLAYING,
    playingClipName: null,
    firedSlotIndex: 0,
    firedClipName: 'Song A',
  });
  assert.equal(resolveAuthoritativeClip(state), 'Song A');
});

test('stopped track yields null', () => {
  const state = track({
    playingSlotIndex: NOTHING_PLAYING,
    playingClipName: null,
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
  });
  assert.equal(resolveAuthoritativeClip(state), null);
});

test('arrangement playback uses arrangement clip name', () => {
  const state = track({
    playingSlotIndex: -2,
    playingClipName: null,
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
    arrangementClipName: 'Still Night',
  });
  assert.equal(resolveAuthoritativeClip(state), 'Still Night');
});

test('session fire still wins over arrangement clip', () => {
  const state = track({
    playingSlotIndex: -2,
    playingClipName: null,
    firedSlotIndex: 3,
    firedClipName: 'Song B',
    arrangementClipName: 'Still Night',
  });
  assert.equal(resolveAuthoritativeClip(state), 'Song B');
});

test('arrangement without a clip under the playhead yields null', () => {
  const state = track({
    playingSlotIndex: -2,
    arrangementClipName: null,
  });
  assert.equal(resolveAuthoritativeClip(state), null);
});

test('pending launch with unresolved fired name yields null', () => {
  const state = track({
    playingSlotIndex: 0,
    playingClipName: 'Song A',
    firedSlotIndex: 1,
    firedClipName: null,
  });
  assert.equal(resolveAuthoritativeClip(state), null);
});

test('latch holds fired clip after pending clears until playing name confirms', () => {
  const state = track({
    playingSlotIndex: 1,
    playingClipName: 'Song A',
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
    latchedClipName: 'Song B',
    latchedSlotIndex: 1,
  });
  assert.equal(resolveAuthoritativeClipWithLatch(state), 'Song B');
  assert.equal(state.latchedClipName, 'Song B');
});

test('latch clears once playing clip name matches', () => {
  const state = track({
    playingSlotIndex: 1,
    playingClipName: 'Song B',
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
    latchedClipName: 'Song B',
    latchedSlotIndex: 1,
  });
  assert.equal(resolveAuthoritativeClipWithLatch(state), 'Song B');
  assert.equal(state.latchedClipName, null);
});

test('pending launch sets latch', () => {
  const state = track({
    playingSlotIndex: 0,
    playingClipName: 'Song A',
    firedSlotIndex: 1,
    firedClipName: 'Song B',
  });
  assert.equal(resolveAuthoritativeClipWithLatch(state), 'Song B');
  assert.equal(state.latchedClipName, 'Song B');
  assert.equal(state.latchedSlotIndex, 1);
});

test('latch clears on stop', () => {
  const state = track({
    playingSlotIndex: NOTHING_PLAYING,
    playingClipName: null,
    firedSlotIndex: NOTHING_PLAYING,
    firedClipName: null,
    latchedClipName: 'Song B',
    latchedSlotIndex: 1,
  });
  assert.equal(resolveAuthoritativeClipWithLatch(state), null);
  assert.equal(state.latchedClipName, null);
});
