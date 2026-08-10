// Machine-readable health report for monitoring and load balancers (M6).

export function buildHealthReport({
  simulated,
  getSheetSnapshot,
  getConnectedViewCount,
  getIngestStatus,
  getTimecodeStatus,
  lastCuePayload = null,
}) {
  const sheets = getSheetSnapshot();
  const ingest = getIngestStatus?.() ?? {
    live: true,
    lastSeenAt: null,
    trackNames: null,
    cueTrackConfigured: null,
    cueTrackFound: null,
  };
  const checks = [];

  if (!simulated && sheets.rows.length === 0) checks.push('no_sheet_data');
  if (sheets.stale) checks.push('sheet_stale');
  if (!simulated && !ingest.live) checks.push('ingest_offline');
  if (!simulated && !lastCuePayload) checks.push('no_cue_payload_yet');
  if (!simulated && ingest.live && ingest.cueTrackFound === false) {
    checks.push('cue_track_missing');
  }

  const timecode = getTimecodeStatus?.() ?? null;

  return {
    status: checks.length === 0 ? 'ok' : 'degraded',
    uptime: process.uptime(),
    simulated,
    ingest: {
      live: ingest.live,
      lastSeenAt: ingest.lastSeenAt,
      trackNames: ingest.trackNames ?? null,
      cueTrackConfigured: ingest.cueTrackConfigured ?? null,
      cueTrackFound: ingest.cueTrackFound ?? null,
    },
    timecode: timecode
      ? {
          enabled: timecode.enabled === true,
          live: timecode.live === true,
          lastSeenAt: timecode.lastSeenAt ?? null,
          timecode: timecode.timecode ?? null,
        }
      : null,
    sheets: {
      syncedAt: sheets.syncedAt,
      stale: sheets.stale,
      rowCount: sheets.rows.length,
    },
    views: {
      connected: getConnectedViewCount(),
    },
    cue: lastCuePayload
      ? {
          clipName: lastCuePayload.clipName,
          matched: lastCuePayload.match?.matched ?? false,
        }
      : null,
    checks,
  };
}
