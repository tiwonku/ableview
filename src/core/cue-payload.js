// CuePayload contract (spec §9.2). Matcher → server → views.
//
// lastMatched is a sticky snapshot of the last confident match. It MAY include
// `row` for the operator Last pane. Views MUST NOT treat lastMatched as the
// current cue (NFR-7): `payload.row` is live-match only.

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

function cloneSheetRow(row) {
  if (!row || typeof row !== 'object') return null;
  return { ...row };
}

/**
 * Last-win snapshot. `row` is for the explicit Last pane only — never copy it
 * onto CuePayload.row when unmatched (NFR-7).
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
  const row = cloneSheetRow(payload.row);
  if (row) lastMatched.row = row;
  return lastMatched;
}

/** Refresh lastMatched.row from the current sheet snapshot (same rowId). */
export function refreshLastMatchedRow(lastMatched, snapshot) {
  if (!lastMatched) return null;
  const rowId = lastMatched.rowId != null ? String(lastMatched.rowId) : '';
  if (!rowId) return lastMatched;
  const found = snapshot?.rows?.find((r) => String(r.rowId) === rowId);
  const data = found?.data;
  if (!data || typeof data !== 'object') return lastMatched;
  return { ...lastMatched, row: { ...data } };
}

export function makeMatchResult({
  matched,
  confidence = 0,
  rowId = null,
  matchedValue = null,
  viaAlias = false,
  viaOverride = false,
}) {
  const result = { matched, confidence, viaAlias };
  if (rowId != null) result.rowId = rowId;
  if (matchedValue != null) result.matchedValue = matchedValue;
  if (viaOverride) result.viaOverride = true;
  return result;
}

/** Apply a temporary pin onto an unmatched payload. Returns null if the row is gone. */
export function applyPinnedRow(payload, snapshot, matchColumn, rowId) {
  const id = rowId != null ? String(rowId) : '';
  if (!id) return null;
  const found = snapshot?.rows?.find((r) => String(r.rowId) === id);
  if (!found?.data || typeof found.data !== 'object') return null;
  const matchedValue = String(found.data[matchColumn] ?? '').trim()
    || payload?.clipName
    || '';
  return {
    ...payload,
    match: makeMatchResult({
      matched: true,
      confidence: 1,
      rowId: String(found.rowId),
      matchedValue,
      viaOverride: true,
    }),
    row: { ...found.data },
  };
}
