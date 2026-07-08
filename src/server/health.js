// Machine-readable health report for monitoring and load balancers (M6).

export function buildHealthReport({
  simulated,
  getSheetSnapshot,
  getConnectedViewCount,
  lastCuePayload = null,
}) {
  const sheets = getSheetSnapshot();
  const checks = [];

  if (!simulated && sheets.rows.length === 0) checks.push('no_sheet_data');
  if (sheets.stale) checks.push('sheet_stale');
  if (!simulated && !lastCuePayload) checks.push('no_cue_payload_yet');

  return {
    status: checks.length === 0 ? 'ok' : 'degraded',
    uptime: process.uptime(),
    simulated,
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
