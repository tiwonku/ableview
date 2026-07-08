// Admin settings panel (M7). Fetches/patches /api/config/settings.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fieldRow(label, input) {
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

function settingsFromForm(form, current) {
  const fd = new FormData(form);
  const watchedRaw = fd.get('watchedTracks')?.trim() ?? '';
  const watchedTracks = watchedRaw
    ? watchedRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  let track = fd.get('authoritativeTrack')?.trim() ?? '';
  if (track !== '' && /^\d+$/.test(track)) track = Number(track);

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
        strategy: 'track',
        track: track === '' ? null : track,
      },
    },
    sheets: {
      worksheet: fd.get('worksheet')?.trim() ?? current.sheets.worksheet,
      headerRow: Number(fd.get('headerRow')),
      matchColumn: fd.get('matchColumn')?.trim() ?? current.sheets.matchColumn,
      aliasColumn: fd.get('aliasColumn')?.trim() ?? current.sheets.aliasColumn,
      refreshSeconds: Number(fd.get('refreshSeconds')),
    },
    match: {
      threshold: Number(fd.get('threshold')),
    },
  };
}

function renderForm(root, settings, { onSave, onSync, status, sheetStatus, syncStatus }) {
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
  ingestGroup.appendChild(fieldRow('Ableton host (IP)', textInput('abletonHost', settings.ingest.abletonHost)));
  ingestGroup.appendChild(fieldRow('OSC listen port', numberInput('oscListenPort', settings.ingest.oscListenPort, { min: 1, max: 65535 })));
  ingestGroup.appendChild(fieldRow('OSC send port', numberInput('oscSendPort', settings.ingest.oscSendPort, { min: 1, max: 65535 })));
  ingestGroup.appendChild(fieldRow(
    'Watched tracks',
    textInput('watchedTracks', (settings.ingest.watchedTracks ?? []).join(', '))
  ));
  ingestGroup.appendChild(fieldRow(
    'Cue track (name or index)',
    textInput('authoritativeTrack', settings.ingest.authoritative?.track ?? '')
  ));
  topRow.appendChild(ingestGroup);

  const sheetsGroup = el('fieldset', 'settings-group');
  sheetsGroup.appendChild(el('legend', null, 'Google Sheet'));
  sheetsGroup.appendChild(fieldRow('Worksheet tab', textInput('worksheet', settings.sheets.worksheet)));
  sheetsGroup.appendChild(fieldRow('Header row', numberInput('headerRow', settings.sheets.headerRow, { min: 1 })));
  sheetsGroup.appendChild(fieldRow('Match column', textInput('matchColumn', settings.sheets.matchColumn)));
  sheetsGroup.appendChild(fieldRow('Alias column', textInput('aliasColumn', settings.sheets.aliasColumn)));
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
  let sheetStatus = null;
  let syncStatus = null;

  function render() {
    renderForm(root, settings, { onSave: save, onSync: syncSheet, status, sheetStatus, syncStatus });
  }

  async function loadSheetStatus() {
    const res = await fetch('/api/sheets/status');
    if (res.ok) sheetStatus = await res.json();
  }

  async function load() {
    const res = await fetch('/api/config/settings');
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const data = await res.json();
    settings = data.settings;
    await loadSheetStatus();
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
    settings = data.settings;
    const reloaded = data.reloaded?.length ? ` Reloaded: ${data.reloaded.join(', ')}.` : '';
    status = { ok: true, message: `Settings saved.${reloaded}` };
    await loadSheetStatus();
    render();
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
}
