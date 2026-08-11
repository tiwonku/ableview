import { isValidSlot } from './authoritative-clip.js';

export function makeSceneInfo({
  index = null,
  name = null,
  launchType = null,
  pending = false,
  trackIndex = null,
  trackName = null,
  launchId = null,
} = {}) {
  return {
    index,
    name,
    launchType,
    pending,
    trackIndex,
    trackName,
    launchId,
  };
}

/** Snapshot of per-track slot state for launch detection. */
export function snapshotTrackSlots(trackStateEntries) {
  return trackStateEntries.map(([trackIndex, state]) => ({
    trackIndex,
    trackName: state.trackName,
    playingSlotIndex: state.playingSlotIndex,
    firedSlotIndex: state.firedSlotIndex,
  }));
}

function launchSlotForTrack(track) {
  if (isValidSlot(track.firedSlotIndex)) return track.firedSlotIndex;
  if (isValidSlot(track.playingSlotIndex)) return track.playingSlotIndex;
  return null;
}

/**
 * Classify a launch from slot changes across watched tracks.
 * Empty scene rows may only move one deck — use sceneTriggeredIndex / selectedSceneIndex
 * to still count those as scene launches.
 *
 * @returns {ReturnType<typeof makeSceneInfo> | null}
 */
export function classifySlotChanges(prevTracks, nextTracks, {
  sceneTriggeredIndex = null,
  selectedSceneIndex = null,
} = {}) {
  const prevByIndex = new Map(prevTracks.map((t) => [t.trackIndex, t]));
  const changed = [];

  for (const next of nextTracks) {
    const prev = prevByIndex.get(next.trackIndex);
    if (!prev) continue;
    const firedChanged = prev.firedSlotIndex !== next.firedSlotIndex;
    const playingChanged = prev.playingSlotIndex !== next.playingSlotIndex;
    if (!firedChanged && !playingChanged) continue;
    changed.push(next);
  }

  if (changed.length === 0) return null;

  const bySlot = new Map();
  for (const track of changed) {
    const slot = launchSlotForTrack(track);
    if (slot == null) continue;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(track);
  }

  let bestSlot = null;
  let bestGroup = [];
  for (const [slot, group] of bySlot) {
    if (group.length > bestGroup.length) {
      bestSlot = slot;
      bestGroup = group;
    }
  }

  if (bestSlot == null) return null;

  const sparseScene = bestGroup.length === 1
    && (sceneTriggeredIndex === bestSlot || selectedSceneIndex === bestSlot);

  if (bestGroup.length >= 2 || sparseScene) {
    return makeSceneInfo({
      index: bestSlot,
      launchType: 'scene',
      pending: bestGroup.some((t) => isValidSlot(t.firedSlotIndex)
        && t.firedSlotIndex !== t.playingSlotIndex),
    });
  }

  const track = bestGroup[0];
  return makeSceneInfo({
    index: bestSlot,
    launchType: 'clip',
    pending: isValidSlot(track.firedSlotIndex)
      && track.firedSlotIndex !== track.playingSlotIndex,
    trackIndex: track.trackIndex,
    trackName: track.trackName,
  });
}

/**
 * Derive display scene state from the tracks array on NowPlaying (post-latch).
 */
export function sceneFromNowPlayingTracks(tracks, { pendingLaunch = false } = {}) {
  const active = (tracks ?? []).filter((t) => isValidSlot(t.slotIndex));
  if (active.length === 0) {
    return makeSceneInfo({ pending: pendingLaunch });
  }

  const bySlot = new Map();
  for (const track of active) {
    const slot = track.slotIndex;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(track);
  }

  let bestSlot = null;
  let bestGroup = [];
  for (const [slot, group] of bySlot) {
    if (group.length > bestGroup.length) {
      bestSlot = slot;
      bestGroup = group;
    }
  }

  if (bestGroup.length >= 2) {
    return makeSceneInfo({
      index: bestSlot,
      launchType: 'scene',
      pending: pendingLaunch,
    });
  }

  const track = bestGroup[0];
  return makeSceneInfo({
    index: bestSlot,
    launchType: 'clip',
    pending: pendingLaunch,
    trackIndex: track.trackIndex ?? null,
    trackName: track.trackName ?? null,
  });
}

export function launchLogKey(scene) {
  if (!scene?.launchType || scene.launchId == null) return null;
  return String(scene.launchId);
}

export function mergeSceneInfo(displayScene, launchScene, sceneName) {
  const base = displayScene ?? makeSceneInfo();
  const launchType = launchScene?.launchType ?? base.launchType;
  const index = launchScene?.index ?? base.index;
  return makeSceneInfo({
    index,
    name: sceneName ?? null,
    launchType,
    pending: base.pending || launchScene?.pending === true,
    trackIndex: launchScene?.trackIndex ?? base.trackIndex,
    trackName: launchScene?.trackName ?? base.trackName,
    launchId: launchScene?.launchId ?? base.launchId ?? null,
  });
}
