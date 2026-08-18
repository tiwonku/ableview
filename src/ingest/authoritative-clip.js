// Resolves which clip name is authoritative for matching. When a clip is
// fired but not yet playing (quantization gap), the fired clip wins so
// operator views switch on launch, not on downbeat. Arrangement playback
// (playing_slot_index = -2) uses the clip under the playhead.

import { isArrangementPlaying } from './arrangement-clip.js';

export const NOTHING_PLAYING = -1; // AbletonOSC: -1 = stopped, -2 = arrangement

export function isValidSlot(slotIndex) {
  return slotIndex != null && slotIndex > NOTHING_PLAYING;
}

export function isPendingLaunch(playingSlotIndex, firedSlotIndex) {
  return isValidSlot(firedSlotIndex) && firedSlotIndex !== playingSlotIndex;
}

/** @param {{ playingSlotIndex, playingClipName, firedSlotIndex, firedClipName, arrangementClipName }} track */
export function resolveAuthoritativeClip(track) {
  if (isPendingLaunch(track.playingSlotIndex, track.firedSlotIndex)) {
    return track.firedClipName ?? null;
  }
  if (isArrangementPlaying(track.playingSlotIndex)) {
    return track.arrangementClipName ?? null;
  }
  return isValidSlot(track.playingSlotIndex) ? (track.playingClipName ?? null) : null;
}

/**
 * Like resolveAuthoritativeClip, but holds the latched clip after a fire until
 * playingClipName confirms it — prevents a brief flash of the previous song when
 * fired clears before the playing slot's clip name is fetched.
 *
 * Mutates track.latchedClipName / track.latchedSlotIndex.
 */
export function resolveAuthoritativeClipWithLatch(track) {
  const pending = isPendingLaunch(track.playingSlotIndex, track.firedSlotIndex);
  const resolved = resolveAuthoritativeClip(track);

  if (pending && track.firedClipName) {
    track.latchedClipName = track.firedClipName;
    track.latchedSlotIndex = track.firedSlotIndex;
    return track.firedClipName;
  }

  if (track.latchedClipName != null) {
    const playingConfirmed = track.playingClipName === track.latchedClipName;

    if (playingConfirmed) {
      track.latchedClipName = null;
      track.latchedSlotIndex = null;
      return resolved;
    }

    if (!isValidSlot(track.playingSlotIndex) && !isValidSlot(track.firedSlotIndex)) {
      track.latchedClipName = null;
      track.latchedSlotIndex = null;
      return resolved;
    }

    return track.latchedClipName;
  }

  return resolved;
}
