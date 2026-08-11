// Admin settings panel (M7). Fetches/patches /api/config/settings.

const TIMECODE_DEFAULTS = Object.freeze({
  enabled: false,
  port: 6454,
  bindAddress: '0.0.0.0',
  staleMs: 500,
});

const MOMENTS_DEFAULTS = Object.freeze({
  autoStartOnMoment: true,
  kinds: ['dope'],
  debounceMs: 0,
});

function normalizeSettings(raw) {
  if (!raw) return raw;
  return {
    ...raw,
    timecode: { ...TIMECODE_DEFAULTS, ...raw.timecode },
    moments: { ...MOMENTS_DEFAULTS, ...raw.moments },
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fieldRow(label, input, { stacked = false } = {}) {
  if (stacked) {
    const row = el('div', 'settings-field settings-field-stacked');
    const lab = el('label', 'settings-label', label);
    if (input.id) lab.htmlFor = input.id;
    row.appendChild(lab);
    row.appendChild(input);
    return row;
  }

  const row = el('label', 'settings-field');
  row.appendChild(el('span', 'settings-label', label));
  row.appendChild(input);
  return row;
}

function textInput(name, value) {
  const input = el('input');
  input.type = 'text';
  input.name = name;
  input.value = value ?? '';
  input.className = 'settings-input';
  return input;
}

function numberInput(name, value, { min, max, step } = {}) {
  const input = el('input');
  input.type = 'number';
  input.name = name;
  input.value = value ?? '';
  input.className = 'settings-input';
  if (min != null) input.min = String(min);
  if (max != null) input.max = String(max);
  if (step != null) input.step = String(step);
  return input;
}

function formatSyncTime(iso) {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function sheetStatusLine(sheetStatus) {
  if (!sheetStatus) return 'Loading sync status…';
  const when = formatSyncTime(sheetStatus.syncedAt);
  const rows = sheetStatus.rowCount ?? 0;
  const fresh = sheetStatus.stale ? 'stale (offline cache)' : 'fresh';
  return `Last sync: ${when} · ${rows} rows · ${fresh}`;
}

function formatIngestSeen(lastSeenAt) {
  if (!lastSeenAt) return null;
  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString();
}

function renderTimecodeStatusBox(timecodeStatus, settings) {
  const box = el('div', 'ableton-session timecode-session');
  box.dataset.role = 'timecode-session';
  box.appendChild(el('p', 'ableton-session-title', 'Art-Net timecode'));

  const enabled = settings?.timecode?.enabled === true;
  if (!enabled) {
    box.classList.add('ableton-session--sim');
    box.appendChild(el(
      'p',
      'ableton-session-line',
      'Timecode listener is off. Enable below and save to receive SMPTE over Art-Net.',
    ));
    return box;
  }

  if (!timecodeStatus) {
    box.appendChild(el('p', 'ableton-session-line', 'Loading timecode status…'));
    return box;
  }

  const live = timecodeStatus.live === true;
  const tc = timecodeStatus.timecode;
  const signalLine = el('p', `ableton-session-line${live ? '' : ' warn'}`);
  const seen = formatIngestSeen(timecodeStatus.lastSeenAt);
  if (!tc?.display) {
    signalLine.textContent = live
      ? 'Listening — no packets yet'
      : 'No signal — check port, bind address, and Art-Net timecode source';
  } else if (live) {
    const rate = tc.typeLabel && tc.fps != null ? ` · ${tc.typeLabel} ${tc.fps} fps` : '';
    signalLine.textContent = `Live: ${tc.display}${rate}${seen ? ` (last packet ${seen})` : ''}`;
  } else {
    const rate = tc.typeLabel && tc.fps != null ? ` · ${tc.typeLabel} ${tc.fps} fps` : '';
    signalLine.textContent = `Stale: ${tc.display}${rate} — no recent packets`;
  }
  box.appendChild(signalLine);

  const port = settings.timecode?.port ?? 6454;
  const bind = settings.timecode?.bindAddress ?? '0.0.0.0';
  const listenLine = el('p', 'ableton-session-line');
  listenLine.textContent = `Listening on UDP ${bind}:${port}`;
  box.appendChild(listenLine);

  if (live && tc?.display) {
    box.classList.add('ableton-session--ok');
  } else if (enabled) {
    box.classList.add('ableton-session--warn');
  }

  return box;
}

function renderAbletonSessionBox(ingestStatus, simulated) {
  const box = el('div', 'ableton-session');
  box.dataset.role = 'ableton-session';
  box.appendChild(el('p', 'ableton-session-title', 'Ableton session'));

  if (simulated) {
    box.classList.add('ableton-session--sim');
    box.appendChild(el(
      'p',
      'ableton-session-line',
      'Simulation mode — not checking the live Ableton session.'
    ));
    return box;
  }

  if (!ingestStatus) {
    box.appendChild(el('p', 'ableton-session-line', 'Loading connection status…'));
    return box;
  }

  const live = ingestStatus.live === true;
  const oscLine = el('p', `ableton-session-line${live ? '' : ' warn'}`);
  const seen = formatIngestSeen(ingestStatus.lastSeenAt);
  oscLine.textContent = live
    ? `OSC link: Live${seen ? ` (last reply ${seen})` : ''}`
    : 'OSC link: No signal — AbletonOSC not answering (check host, ports, remote script)';
  box.appendChild(oscLine);

  const tracks = ingestStatus.trackNames;
  const tracksLine = el('p', 'ableton-session-line');
  if (tracks == null) {
    tracksLine.textContent = live
      ? 'Session: waiting for track list…'
      : 'Session: not seen yet';
    if (!live) tracksLine.classList.add('warn');
  } else if (tracks.length === 0) {
    tracksLine.textContent = 'Session: connected (no tracks reported)';
    tracksLine.classList.add('warn');
  } else {
    tracksLine.textContent = `Session: found (${tracks.length} tracks) — ${tracks.join(', ')}`;
  }
  box.appendChild(tracksLine);

  const configured = ingestStatus.cueTrackConfigured;
  const cueLine = el('p', 'ableton-session-line');
  if (configured == null || configured === '') {
    cueLine.textContent = 'Cue track: optional (bestMatch uses watched tracks)';
  } else if (ingestStatus.cueTrackFound == null) {
    cueLine.textContent = `Cue track: waiting to verify "${configured}"…`;
  } else if (ingestStatus.cueTrackFound) {
    cueLine.textContent = `Cue track: found "${configured}"`;
  } else {
    cueLine.textContent = `Cue track: missing "${configured}" — rename in Live or change the field below to a track from the list above`;
    cueLine.classList.add('warn');
  }
  box.appendChild(cueLine);

  if (!live || (configured != null && configured !== '' && ingestStatus.cueTrackFound === false)) {
    box.classList.add('ableton-session--warn');
  } else if (tracks != null) {
    box.classList.add('ableton-session--ok');
  }

  return box;
}

function settingsFromForm(form, current) {
  const fd = new FormData(form);
  const watchedRaw = fd.get('watchedTracks')?.trim() ?? '';
  const watchedTracks = watchedRaw
    ? watchedRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  let track = fd.get('authoritativeTrack')?.trim() ?? '';
  if (track !== '' && /^\d+$/.test(track)) track = Number(track);

  const strategyRaw = fd.get('authoritativeStrategy')?.trim();
  const strategy = strategyRaw || current.ingest.authoritative?.strategy || 'bestMatch';

  return {
    sim: {
      enabled: fd.get('simEnabled') === 'on',
    },
    ingest: {
      abletonHost: fd.get('abletonHost')?.trim() ?? current.ingest.abletonHost,
      oscListenPort: Number(fd.get('oscListenPort')),
      oscSendPort: Number(fd.get('oscSendPort')),
      watchedTracks,
      authoritative: {
        strategy,
        track: track === '' ? null : track,
      },
    },
    sheets: {
      worksheet: fd.get('worksheet')?.trim() ?? current.sheets.worksheet,
      headerRow: Number(fd.get('headerRow')),
      matchColumn: fd.get('matchColumn')?.trim() ?? current.sheets.matchColumn,
      aliasColumn: fd.get('aliasColumn')?.trim() ?? current.sheets.aliasColumn,
      alsFolderColumn: fd.get('alsFolderColumn')?.trim() || current.sheets.alsFolderColumn || null,
      refreshSeconds: Number(fd.get('refreshSeconds')),
    },
    match: {
      threshold: Number(fd.get('threshold')),
    },
    timecode: {
      enabled: fd.get('timecodeEnabled') === 'on',
      port: Number(fd.get('timecodePort')),
      bindAddress: fd.get('timecodeBindAddress')?.trim() ?? current.timecode?.bindAddress ?? '0.0.0.0',
      staleMs: Number(fd.get('timecodeStaleMs')),
    },
    moments: {
      autoStartOnMoment: fd.get('momentsAutoStart') === 'on',
      kinds: (fd.get('momentsKinds')?.trim() ?? 'dope')
        .split(/[,\s]+/)
        .map((k) => k.trim())
        .filter(Boolean),
      debounceMs: Number(fd.get('momentsDebounceMs')),
    },
  };
}

function renderForm(root, settings, { onSave, onSync, status, sheetStatus, syncStatus, ingestStatus, timecodeStatus }) {
  root.innerHTML = '';

  const heading = el('h2', 'section-title', 'Settings');
  root.appendChild(heading);

  const hint = el('p', 'settings-hint');
  hint.textContent = 'Changes save to config.json and apply immediately. Secrets (sheet ID, service account) stay in .env.';
  root.appendChild(hint);

  if (status?.message) {
    const banner = el('div', `settings-status ${status.ok ? 'ok' : 'err'}`);
    banner.textContent = status.message;
    root.appendChild(banner);
  }

  const form = el('form', 'settings-form');
  form.noValidate = true;

  const grid = el('div', 'settings-grid');

  const topRow = el('div', 'settings-row');
  const bottomRow = el('div', 'settings-row');

  const ingestGroup = el('fieldset', 'settings-group');
  ingestGroup.appendChild(el('legend', null, 'Ableton / OSC'));
  ingestGroup.appendChild(renderAbletonSessionBox(ingestStatus, settings.sim?.enabled === true));
  ingestGroup.appendChild(fieldRow('Ableton host (IP)', textInput('abletonHost', settings.ingest.abletonHost)));
  ingestGroup.appendChild(fieldRow('OSC listen port', numberInput('oscListenPort', settings.ingest.oscListenPort, { min: 1, max: 65535 })));
  ingestGroup.appendChild(fieldRow('OSC send port', numberInput('oscSendPort', settings.ingest.oscSendPort, { min: 1, max: 65535 })));
  ingestGroup.appendChild(fieldRow(
    'Watched tracks',
    textInput('watchedTracks', (settings.ingest.watchedTracks ?? []).join(', ')),
    { stacked: true }
  ));
  const strategySelect = el('select', 'settings-input');
  strategySelect.name = 'authoritativeStrategy';
  for (const [value, label] of [
    ['bestMatch', 'bestMatch (all watched decks)'],
    ['track', 'track (single cue track)'],
  ]) {
    const opt = el('option', null, label);
    opt.value = value;
    if ((settings.ingest.authoritative?.strategy ?? 'bestMatch') === value) {
      opt.selected = true;
    }
    strategySelect.appendChild(opt);
  }
  ingestGroup.appendChild(fieldRow('Match strategy', strategySelect));
  ingestGroup.appendChild(fieldRow(
    'Cue track',
    textInput('authoritativeTrack', settings.ingest.authoritative?.track ?? ''),
    { stacked: true }
  ));
  const cueHint = el('p', 'settings-field-hint');
  cueHint.textContent = 'Optional with bestMatch. Required when strategy is track.';
  ingestGroup.appendChild(cueHint);
  topRow.appendChild(ingestGroup);

  const sheetsGroup = el('fieldset', 'settings-group');
  sheetsGroup.appendChild(el('legend', null, 'Google Sheet'));
  sheetsGroup.appendChild(fieldRow('Worksheet tab', textInput('worksheet', settings.sheets.worksheet)));
  sheetsGroup.appendChild(fieldRow('Header row', numberInput('headerRow', settings.sheets.headerRow, { min: 1 })));
  sheetsGroup.appendChild(fieldRow('Match column', textInput('matchColumn', settings.sheets.matchColumn)));
  sheetsGroup.appendChild(fieldRow('Alias column', textInput('aliasColumn', settings.sheets.aliasColumn)));
  sheetsGroup.appendChild(fieldRow(
    'ALS Folder column (soft match key)',
    textInput('alsFolderColumn', settings.sheets.alsFolderColumn ?? 'ALS Folder')
  ));
  sheetsGroup.appendChild(fieldRow('Refresh (seconds)', numberInput('refreshSeconds', settings.sheets.refreshSeconds, { min: 1 })));

  const sheetMeta = el('p', 'settings-sheet-status');
  sheetMeta.textContent = sheetStatusLine(sheetStatus);
  sheetsGroup.appendChild(sheetMeta);

  const syncRow = el('div', 'settings-sync-row');
  const syncBtn = el('button', 'settings-sync', 'Sync sheet now');
  syncBtn.type = 'button';
  syncBtn.disabled = syncStatus?.pending === true;
  syncBtn.textContent = syncStatus?.pending ? 'Syncing…' : 'Sync sheet now';
  syncRow.appendChild(syncBtn);
  sheetsGroup.appendChild(syncRow);

  if (syncStatus?.message && !syncStatus.pending) {
    const syncBanner = el('div', `settings-status ${syncStatus.ok ? 'ok' : 'err'}`);
    syncBanner.textContent = syncStatus.message;
    sheetsGroup.appendChild(syncBanner);
  }

  syncBtn.addEventListener('click', () => onSync?.());
  topRow.appendChild(sheetsGroup);

  const simGroup = el('fieldset', 'settings-group settings-group-sim');
  simGroup.appendChild(el('legend', null, 'Simulation'));
  const simEnabled = settings.sim?.enabled === true;
  const simCheck = el('input');
  simCheck.type = 'checkbox';
  simCheck.name = 'simEnabled';
  simCheck.id = 'simEnabled';
  simCheck.checked = simEnabled;
  simCheck.className = 'settings-checkbox';
  const simRow = el('div', 'settings-field settings-field-checkbox');
  simRow.appendChild(simCheck);
  const simLabel = el('label', 'settings-checkbox-label');
  simLabel.htmlFor = 'simEnabled';
  simLabel.textContent = 'Simulation mode (fake clip changes — not live Ableton)';
  simRow.appendChild(simLabel);
  simGroup.appendChild(simRow);
  if (simEnabled) {
    const simWarn = el('p', 'settings-sim-warn');
    simWarn.textContent = 'Simulation is ON. Operator views show fake data. Turn off before show night.';
    simGroup.appendChild(simWarn);
  } else {
    const simHint = el('p', 'settings-sim-hint');
    simHint.textContent = 'When off, AbleView listens to the real Ableton session via OSC.';
    simGroup.appendChild(simHint);
  }
  bottomRow.appendChild(simGroup);

  const timecodeGroup = el('fieldset', 'settings-group');
  timecodeGroup.appendChild(el('legend', null, 'Timecode (Art-Net)'));
  timecodeGroup.appendChild(renderTimecodeStatusBox(timecodeStatus, settings));

  const tcEnabled = settings.timecode?.enabled === true;
  const tcCheck = el('input');
  tcCheck.type = 'checkbox';
  tcCheck.name = 'timecodeEnabled';
  tcCheck.id = 'timecodeEnabled';
  tcCheck.checked = tcEnabled;
  tcCheck.className = 'settings-checkbox';
  const tcRow = el('div', 'settings-field settings-field-checkbox');
  tcRow.appendChild(tcCheck);
  const tcLabel = el('label', 'settings-checkbox-label');
  tcLabel.htmlFor = 'timecodeEnabled';
  tcLabel.textContent = 'Receive SMPTE timecode over Art-Net (UDP)';
  tcRow.appendChild(tcLabel);
  timecodeGroup.appendChild(tcRow);

  timecodeGroup.appendChild(fieldRow(
    'UDP port',
    numberInput('timecodePort', settings.timecode?.port ?? 6454, { min: 1, max: 65535 }),
  ));
  timecodeGroup.appendChild(fieldRow(
    'Listen on (local IP)',
    textInput('timecodeBindAddress', settings.timecode?.bindAddress ?? '0.0.0.0'),
  ));
  timecodeGroup.appendChild(fieldRow(
    'Stale after (ms)',
    numberInput('timecodeStaleMs', settings.timecode?.staleMs ?? 500, { min: 0, step: 50 }),
  ));

  const tcHint = el('p', 'settings-sim-hint');
  tcHint.textContent = 'Use 0.0.0.0 to listen on all network interfaces — you will receive Art-Net from Timecode Expert and other senders on the LAN. This is not the sender\'s IP (e.g. the address shown in Timecode Expert). Only set a specific IP if this PC has multiple NICs. Supports drop-frame 29.97 (DF) and other SMPTE types automatically.';
  timecodeGroup.appendChild(tcHint);

  bottomRow.appendChild(timecodeGroup);

  const momentsGroup = el('fieldset', 'settings-group');
  momentsGroup.appendChild(el('legend', null, 'Moments (Stream Deck)'));
  const momentsAuto = settings.moments?.autoStartOnMoment !== false;
  const momentsAutoCheck = el('input');
  momentsAutoCheck.type = 'checkbox';
  momentsAutoCheck.name = 'momentsAutoStart';
  momentsAutoCheck.id = 'momentsAutoStart';
  momentsAutoCheck.className = 'settings-checkbox';
  momentsAutoCheck.checked = momentsAuto;
  const momentsAutoRow = el('div', 'settings-field settings-field-checkbox');
  momentsAutoRow.appendChild(momentsAutoCheck);
  const momentsAutoLabel = el('label', 'settings-checkbox-label');
  momentsAutoLabel.htmlFor = 'momentsAutoStart';
  momentsAutoLabel.textContent = 'Auto-start session log on first moment tap';
  momentsAutoRow.appendChild(momentsAutoLabel);
  momentsGroup.appendChild(momentsAutoRow);
  momentsGroup.appendChild(fieldRow(
    'Allowed kinds (comma-separated)',
    textInput('momentsKinds', (settings.moments?.kinds ?? ['dope']).join(', ')),
  ));
  momentsGroup.appendChild(fieldRow(
    'Debounce (ms, 0 = off)',
    numberInput('momentsDebounceMs', settings.moments?.debounceMs ?? 0, { min: 0, step: 50 }),
  ));
  const momentsHint = el('p', 'settings-sim-hint');
  momentsHint.textContent = 'Crew Stream Deck buttons POST to /api/moments via Companion. When auto-start is on, the first tap creates a timestamp session name and updates operator views live.';
  momentsGroup.appendChild(momentsHint);
  bottomRow.appendChild(momentsGroup);

  const matchGroup = el('fieldset', 'settings-group');
  matchGroup.appendChild(el('legend', null, 'Matching'));
  matchGroup.appendChild(fieldRow(
    'Confidence threshold (0–1)',
    numberInput('threshold', settings.match.threshold, { min: 0, max: 1, step: 0.05 })
  ));
  bottomRow.appendChild(matchGroup);

  grid.appendChild(topRow);
  grid.appendChild(bottomRow);
  form.appendChild(grid);

  const actions = el('div', 'settings-actions');
  const saveBtn = el('button', 'settings-save', 'Save settings');
  saveBtn.type = 'submit';
  actions.appendChild(saveBtn);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const patch = settingsFromForm(form, settings);
      await onSave(patch);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save settings';
    }
  });

  root.appendChild(form);
}

export function mountSettingsPanel(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return;

  let settings = null;
  let status = null;
  let serverSupportsTimecode = true;
  let sheetStatus = null;
  let syncStatus = null;
  let ingestStatus = null;
  let timecodeStatus = null;
  let pollTimer = null;

  function render() {
    renderForm(root, settings, {
      onSave: save,
      onSync: syncSheet,
      status,
      sheetStatus,
      syncStatus,
      ingestStatus,
      timecodeStatus,
    });
  }

  function refreshAbletonSessionBox() {
    const existing = root.querySelector('[data-role="ableton-session"]');
    if (!existing || !settings) return;
    const next = renderAbletonSessionBox(ingestStatus, settings.sim?.enabled === true);
    existing.replaceWith(next);
  }

  function refreshTimecodeSessionBox() {
    const existing = root.querySelector('[data-role="timecode-session"]');
    if (!existing || !settings) return;
    const next = renderTimecodeStatusBox(timecodeStatus, settings);
    existing.replaceWith(next);
  }

  async function loadSheetStatus() {
    const res = await fetch('/api/sheets/status');
    if (res.ok) sheetStatus = await res.json();
  }

  async function loadHealthStatus() {
    const res = await fetch('/health');
    const data = await res.json().catch(() => null);
    if (data?.ingest) ingestStatus = data.ingest;
    if (data?.timecode) timecodeStatus = data.timecode;
  }

  async function load() {
    const res = await fetch('/api/config/settings');
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const data = await res.json();
    serverSupportsTimecode = data.settings?.timecode !== undefined;
    settings = normalizeSettings(data.settings);
    await Promise.all([loadSheetStatus(), loadHealthStatus()]);
    if (!serverSupportsTimecode) {
      status = {
        ok: false,
        message: 'This AbleView process does not expose timecode settings yet — restart the server (npm start or your service), then reload this page.',
      };
    }
    render();
  }

  async function save(patch) {
    status = null;
    const res = await fetch('/api/config/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      status = { ok: false, message: data.error ?? 'Save failed' };
      render();
      return;
    }
    serverSupportsTimecode = data.settings?.timecode !== undefined;
    settings = normalizeSettings(data.settings);
    const reloaded = data.reloaded?.length ? ` Reloaded: ${data.reloaded.join(', ')}.` : '';
    if (patch.timecode && !data.reloaded?.includes('timecode')) {
      status = {
        ok: false,
        message: `Other settings saved, but timecode was not applied (reload list: ${data.reloaded?.join(', ') || 'none'}). Restart AbleView, reload this page, and save again.`,
      };
      await Promise.all([loadSheetStatus(), wait(400).then(() => loadHealthStatus())]);
      render();
      return;
    }
    status = { ok: true, message: `Settings saved.${reloaded}` };
    await Promise.all([loadSheetStatus(), wait(400).then(() => loadHealthStatus())]);
    render();
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function syncSheet() {
    syncStatus = { pending: true, message: 'Syncing…' };
    render();
    const res = await fetch('/api/sheets/sync', { method: 'POST' });
    const data = await res.json();
    sheetStatus = {
      syncedAt: data.syncedAt,
      stale: data.stale,
      rowCount: data.rowCount,
      worksheet: sheetStatus?.worksheet ?? settings?.sheets?.worksheet,
    };
    if (res.ok) {
      syncStatus = {
        ok: true,
        message: `Synced ${data.rowCount} rows (${data.stale ? 'stale' : 'fresh'}).`,
      };
    } else {
      syncStatus = { ok: false, message: data.error ?? 'Sync failed' };
    }
    render();
  }

  load().catch((err) => {
    root.innerHTML = '';
    const errEl = el('div', 'settings-status err', err.message);
    root.appendChild(errEl);
  });

  pollTimer = setInterval(() => {
    if (!settings) return;
    const prevIngest = JSON.stringify(ingestStatus);
    const prevTimecode = JSON.stringify(timecodeStatus);
    loadHealthStatus()
      .then(() => {
        if (JSON.stringify(ingestStatus) !== prevIngest) refreshAbletonSessionBox();
        if (JSON.stringify(timecodeStatus) !== prevTimecode) refreshTimecodeSessionBox();
      })
      .catch(() => {});
  }, 3000);
  pollTimer.unref?.();
}
