// Machine-readable health report for monitoring and load balancers (M6).

export function buildHealthReport({
  simulated,
  getSheetSnapshot,
  getConnectedViewCount,
  getIngestStatus,
  getTimecodeStatus,
  getLiveColorsStatus,
  getOscOutStatus,
  getProgramStatus,
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
  if (
    !simulated
    && ingest.live
    && ingest.cueTrackConfigured != null
    && ingest.cueTrackFound === false
  ) {
    checks.push('cue_track_missing');
  }

  const oscOut = getOscOutStatus?.() ?? null;
  if (oscOut?.blocked === true) checks.push('osc_out_blocked');

  const timecode = getTimecodeStatus?.() ?? null;
  const liveColors = getLiveColorsStatus?.() ?? null;

  const report = {
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
    sacn: liveColors
      ? {
          enabled: liveColors.enabled === true,
          live: liveColors.live === true,
          lastSeenAt: liveColors.lastSeenAt ?? null,
          universe: liveColors.universe ?? null,
          staticUniverse: liveColors.staticUniverse ?? null,
          fxLive: liveColors.fxLive === true,
          staticLive: liveColors.staticLive === true,
          sourceName: liveColors.sourceName ?? null,
          sourceAddress: liveColors.sourceAddress ?? null,
          colors: liveColors.colors ?? null,
          staticColors: liveColors.staticColors ?? null,
          moving: liveColors.moving === true,
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
    oscOut: oscOut
      ? {
          enabled: oscOut.enabled === true,
          sending: oscOut.sending === true,
          blocked: oscOut.blocked === true,
          pid: oscOut.pid ?? null,
          httpPort: oscOut.httpPort ?? null,
          owner: oscOut.owner ?? null,
        }
      : null,
    checks,
  };

  // Program sources are a parallel lane. A stale deck bridge does not degrade
  // the cue path (M13 §7.4).
  if (typeof getProgramStatus === 'function') {
    report.program = compactProgram(getProgramStatus());
  }

  return report;
}

function compactProgram(status) {
  const sources = Array.isArray(status?.sources) ? status.sources : [];
  return {
    sources: sources.map((source) => ({
      id: source?.id ?? null,
      label: source?.label ?? source?.id ?? null,
      live: source?.live === true,
      lastSeenAt: source?.lastSeenAt ?? null,
      stale: source?.stale === true,
    })),
  };
}
