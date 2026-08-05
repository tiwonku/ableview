// CuePayload contract (spec §9.2). Matcher → server → views.

export function makeCuePayload({
  clipName,
  match,
  row = null,
  tempo = null,
  beat = null,
  syncedAt = null,
  stale = false,
  ingestLive = true,
  simulated = false,
  pendingLaunch = false,
}) {
  const payload = {
    clipName,
    match,
    tempo,
    beat,
    syncedAt,
    stale,
    ingestLive,
    simulated,
    pendingLaunch,
  };
  if (row != null) payload.row = row;
  return payload;
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
