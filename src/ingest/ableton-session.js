// Ableton session diagnostics: OSC liveness vs cue-track presence (independent).

export function findCueTrack(trackNames, configured) {
  const cueTrackConfigured =
    configured === 0 || configured ? configured : null;

  if (trackNames == null) {
    return { cueTrackConfigured, cueTrackFound: null };
  }

  if (cueTrackConfigured == null) {
    return { cueTrackConfigured: null, cueTrackFound: false };
  }

  const found = trackNames.some(
    (name, index) => name === cueTrackConfigured || index === cueTrackConfigured
  );
  return { cueTrackConfigured, cueTrackFound: found };
}

export function makeIngestStatus({
  live,
  lastSeenAt = null,
  trackNames = null,
  authoritativeTrack = null,
} = {}) {
  const { cueTrackConfigured, cueTrackFound } = findCueTrack(
    trackNames,
    authoritativeTrack
  );

  return {
    live: Boolean(live),
    lastSeenAt: lastSeenAt || null,
    trackNames: trackNames == null ? null : [...trackNames],
    cueTrackConfigured,
    cueTrackFound,
  };
}
