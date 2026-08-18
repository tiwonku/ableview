// Arrangement-view clip resolution. Live reports playing_slot_index = -2 when
// a clip is playing from the Arrangement (not a Session slot). AbletonOSC can
// list those clips (name / start_time / length in beats) but has no listener
// for "which one is under the playhead" — we infer it from song time.

export const ARRANGEMENT_PLAYING = -2;

export function isArrangementPlaying(slotIndex) {
  return slotIndex === ARRANGEMENT_PLAYING;
}

/**
 * Zip AbletonOSC arrangement_clips replies into { name, startTime, length }.
 * start_time + length are required; names may arrive later (empty until then).
 */
export function zipArrangementClips(names = [], startTimes = [], lengths = []) {
  const n = Math.min(startTimes.length, lengths.length);
  const clips = [];
  for (let i = 0; i < n; i++) {
    const startTime = Number(startTimes[i]);
    const length = Number(lengths[i]);
    if (!Number.isFinite(startTime) || !Number.isFinite(length) || length <= 0) continue;
    const name = names[i] != null ? String(names[i]) : '';
    clips.push({ name, startTime, length });
  }
  return clips;
}

/**
 * Clip whose half-open range [start, start+length) contains songTime (beats).
 * Overlaps: prefer the clip that started later.
 */
export function clipAtSongTime(clips, songTime) {
  if (songTime == null || !Number.isFinite(Number(songTime))) return null;
  const t = Number(songTime);
  let best = null;
  for (const clip of clips ?? []) {
    const start = Number(clip.startTime);
    const length = Number(clip.length);
    if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) continue;
    if (t >= start && t < start + length) {
      if (!best || start >= best.startTime) best = clip;
    }
  }
  return best;
}

/** Mutates state.arrangementClipName. Returns true if the name changed. */
export function applyArrangementClipName(state, songTime) {
  if (!isArrangementPlaying(state?.playingSlotIndex)) {
    if (state?.arrangementClipName != null) {
      state.arrangementClipName = null;
      return true;
    }
    return false;
  }
  const hit = clipAtSongTime(state.arrangementClips, songTime);
  const name = hit?.name?.trim() ? String(hit.name) : null;
  if (state.arrangementClipName === name) return false;
  state.arrangementClipName = name;
  return true;
}
