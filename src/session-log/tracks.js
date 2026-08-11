export function trackStateKey(tracks) {
  return JSON.stringify(
    (tracks ?? [])
      .map((t) => [t.trackIndex, t.clipName ?? null, t.slotIndex ?? null])
      .sort((a, b) => a[0] - b[0])
  );
}

function parseTrackState(key) {
  if (!key) return new Map();
  const entries = JSON.parse(key);
  const map = new Map();
  for (const [trackIndex, clipName, slotIndex] of entries) {
    map.set(trackIndex, { clipName, slotIndex });
  }
  return map;
}

export function diffTracks(prevKey, nextTracks) {
  const prev = parseTrackState(prevKey);
  const changed = [];
  for (const t of nextTracks ?? []) {
    const prior = prev.get(t.trackIndex);
    const clipName = t.clipName ?? null;
    const slotIndex = t.slotIndex ?? null;
    if (!prior || prior.clipName !== clipName || prior.slotIndex !== slotIndex) {
      changed.push({
        trackIndex: t.trackIndex,
        trackName: t.trackName,
        clipName,
        slotIndex,
      });
    }
  }
  return changed;
}

export function clipKey(payload) {
  return JSON.stringify({ clip: payload.clipName ?? null, simulated: !!payload.simulated });
}

export function matchKey(payload) {
  const m = payload.match ?? {};
  return JSON.stringify({
    clip: payload.clipName ?? null,
    matched: !!m.matched,
    confidence: m.confidence ?? 0,
    rowId: m.rowId ?? null,
    matchedValue: m.matchedValue ?? null,
    viaAlias: !!m.viaAlias,
  });
}
