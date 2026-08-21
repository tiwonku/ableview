// CuePayload contract (spec §9.2). Matcher → server → views.
//
// lastMatched is a sticky snapshot of the last confident match (title + ids,
// never the sheet row). Views MUST NOT treat it as the current cue (NFR-7).

export function makeCuePayload({
  clipName,
  match,
  row = null,
  tempo = null,
  beat = null,
  isPlaying = null,
  syncedAt = null,
  stale = false,
  ingestLive = true,
  ableton = null,
  simulated = false,
  pendingLaunch = false,
  tracks = [],
  trackMatches = [],
  scene = null,
  lastMatched = null,
}) {
  const payload = {
    clipName,
    match,
    tempo,
    beat,
    isPlaying,
    syncedAt,
    stale,
    ingestLive,
    simulated,
    pendingLaunch,
    tracks: Array.isArray(tracks) ? tracks : [],
    trackMatches: Array.isArray(trackMatches) ? trackMatches : [],
  };
  if (scene != null) payload.scene = scene;
  if (row != null) payload.row = row;
  if (ableton != null) payload.ableton = ableton;
  if (lastMatched != null) payload.lastMatched = lastMatched;
  return payload;
}

/** Operator-facing title for a live match (sheet matchColumn, then matchedValue). */
export function resolveMatchedTitle(payload, matchColumn = null) {
  if (payload?.match?.matched !== true) return null;
  const fromRow = matchColumn && String(payload?.row?.[matchColumn] ?? '').trim();
  if (fromRow) return fromRow;
  const fromMatch = payload?.match?.matchedValue?.trim();
  if (fromMatch) return fromMatch;
  const fromClip = payload?.clipName?.trim();
  return fromClip || null;
}

/**
 * Compact last-win snapshot. Omit `row` so unmatched views cannot paint old notes.
 */
export function makeLastMatched(payload, matchColumn = null, matchedAt = new Date().toISOString()) {
  if (payload?.match?.matched !== true) return null;

  const title = resolveMatchedTitle(payload, matchColumn)
    || payload.match.matchedValue
    || payload.clipName
    || '';
  const winner = (payload.trackMatches ?? []).find((tm) => tm.winner)
    ?? (payload.trackMatches ?? []).find(
      (tm) => tm.matched && tm.rowId === payload.match.rowId
    );

  const lastMatched = {
    title,
    clipName: payload.clipName ?? null,
    matchedValue: payload.match.matchedValue ?? null,
    rowId: payload.match.rowId ?? null,
    matchedAt,
  };
  if (winner?.trackName) lastMatched.trackName = winner.trackName;
  if (winner?.trackIndex != null) lastMatched.trackIndex = winner.trackIndex;
  return lastMatched;
}

export function makeMatchResult({
  matched,
  confidence = 0,
  rowId = null,
  matchedValue = null,
  viaAlias = false,
}) {
  const result = { matched, confidence, viaAlias };
  if (rowId != null) result.rowId = rowId;
  if (matchedValue != null) result.matchedValue = matchedValue;
  return result;
}
