// Admin settings panel (M7). Fetches/patches /api/config/settings.

import { copyTextToClipboard } from './clipboard.js';
import {
  defaultShareViewId,
  listedViews,
  shareFromNetResponse,
  shareUrl,
} from './share-links.js';

const FALLBACK_SHARE_VIEWS = Object.freeze({
  band: { title: 'Band' },
  visuals: { title: 'Visuals' },
  lighting: { title: 'Lighting' },
  session: { title: 'Session' },
  setlist: { title: 'Set' },
  breath: { title: 'Breath' },
  admin: { title: 'Admin' },
});

const TIMECODE_DEFAULTS = Object.freeze({
  enabled: false,
  port: 6454,
  bindAddress: '0.0.0.0',
  staleMs: 500,
});

const SACN_DEFAULTS = Object.freeze({
  enabled: false,
  port: 5568,
  bindAddress: '0.0.0.0',
  interfaceAddress: '0.0.0.0',
  multicast: true,
  universe: 191,
  staticUniverse: 191,
  staleMs: 1000,
  ignorePreview: true,
  slots: {
    main: { startChannel: 500, label: 'Color Main' },
    secondary: { startChannel: 503, label: 'Color secondary' },
    accent: { startChannel: 506, label: 'Color accent' },
  },
  staticSlots: {
    main: { startChannel: 491, label: 'Look Main' },
    secondary: { startChannel: 494, label: 'Look secondary' },
    accent: { startChannel: 497, label: 'Look accent' },
  },
  log: {
    changeDelta: 4,
    settleMs: 200,
    motionIntervalMs: 400,
    minIntervalMs: 100,
  },
});

const MOMENTS_DEFAULTS = Object.freeze({
  autoStartOnMoment: true,
  kinds: ['dope', 'typed'],
  debounceMs: 0,
});

const OSCOUT_DEFAULTS = Object.freeze({
  enabled: false,
  destinations: [],
});

function normalizeSettings(raw) {
  if (!raw) return raw;
  return {
    ...raw,
    timecode: { ...TIMECODE_DEFAULTS, ...raw.timecode },
    sacn: normalizeSacn(raw.sacn),
    moments: { ...MOMENTS_DEFAULTS, ...raw.moments },
    oscOut: {
      ...OSCOUT_DEFAULTS,
      ...raw.oscOut,
      destinations: Array.isArray(raw.oscOut?.destinations)
        ? raw.oscOut.destinations.map((d) => ({ host: d.host ?? '', port: d.port ?? 11010 }))
        : [],
    },
  };
}

function mergeSlotGroup(defaults, raw) {
  const slots = { ...defaults, ...(raw ?? {}) };
  return {
    main: { ...defaults.main, ...slots.main },
    secondary: { ...defaults.secondary, ...slots.secondary },
    accent: { ...defaults.accent, ...slots.accent },
  };
}

function normalizeSacn(raw) {
  return {
    ...SACN_DEFAULTS,
    ...raw,
    slots: mergeSlotGroup(SACN_DEFAULTS.slots, raw?.slots),
    staticSlots: mergeSlotGroup(SACN_DEFAULTS.staticSlots, raw?.staticSlots),
    log: { ...SACN_DEFAULTS.log, ...(raw?.log ?? {}) },
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

function rgbChip(label, color, { channel } = {}) {
  const wrap = el('span', 'sacn-chip');
  const swatch = el('span', 'sacn-chip-swatch');
  const ch = Number.isInteger(channel) ? ` ${channel}` : '';
  if (color && Number.isInteger(color.r)) {
    swatch.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
    wrap.appendChild(swatch);
    wrap.appendChild(document.createTextNode(`${label}${ch} ${color.r},${color.g},${color.b}`));
  } else {
    swatch.classList.add('sacn-chip-swatch--empty');
    wrap.appendChild(swatch);
    wrap.appendChild(document.createTextNode(`${label}${ch} —`));
  }
  return wrap;
}

function sacnPreviewRow(title, colors, slots, phase, { universe, live } = {}) {
  const uni = Number.isInteger(universe) ? ` · U${universe}` : '';
  const row = el('div', `sacn-preview-row${live === false ? ' sacn-preview-row--stale' : ''}`);
  row.appendChild(el('span', 'sacn-preview-label', `${title}${uni}`));
  const chips = el('div', 'sacn-chips');
  chips.appendChild(rgbChip('Main', colors?.main, { channel: slots?.main?.startChannel }));
  chips.appendChild(rgbChip('Sec', colors?.secondary, { channel: slots?.secondary?.startChannel }));
  chips.appendChild(rgbChip('Accent', colors?.accent, { channel: slots?.accent?.startChannel }));
  row.appendChild(chips);
  if (phase) {
    const badge = el('span', `sacn-phase sacn-phase--${phase}`, phase === 'move' ? 'MOVE' : 'HOLD');
    row.appendChild(badge);
  }
  return row;
}

function renderSacnStatusBox(sacnStatus, settings) {
  const box = el('div', 'ableton-session sacn-session');
  box.dataset.role = 'sacn-session';
  box.appendChild(el('p', 'ableton-session-title', 'GrandMA colors (sACN)'));

  const enabled = settings?.sacn?.enabled === true;
  if (!enabled) {
    box.classList.add('ableton-session--sim');
    box.appendChild(el(
      'p',
      'ableton-session-line',
      'sACN listener is off. Enable below and save to receive live RGB from GrandMA.',
    ));
    return box;
  }

  if (!sacnStatus) {
    box.appendChild(el('p', 'ableton-session-line', 'Loading sACN status…'));
    return box;
  }

  const live = sacnStatus.live === true;
  const fxLive = sacnStatus.fxLive === true || (sacnStatus.fxLive == null && live);
  const lookLive = sacnStatus.staticLive === true || (sacnStatus.staticLive == null && live);
  const signalLine = el('p', `ableton-session-line${live ? '' : ' warn'}`);
  const seen = formatIngestSeen(sacnStatus.lastSeenAt);
  const fxUni = sacnStatus.universe ?? settings.sacn?.universe ?? 191;
  const lookUni = sacnStatus.staticUniverse ?? settings.sacn?.staticUniverse ?? fxUni;
  const from = sacnStatus.sourceAddress ? ` from ${sacnStatus.sourceAddress}` : '';
  if (live) {
    const name = sacnStatus.sourceName ? ` · ${sacnStatus.sourceName}` : '';
    const uniText = fxUni === lookUni ? `universe ${fxUni}` : `FX U${fxUni} · look U${lookUni}`;
    signalLine.textContent = `Live ${uniText}${from}${name}${seen ? ` (last packet ${seen})` : ''}`;
  } else {
    const uniText = fxUni === lookUni ? `universe ${fxUni}` : `FX U${fxUni} / look U${lookUni}`;
    signalLine.textContent = `No signal on ${uniText} — pick the lighting NIC and confirm GrandMA is sending`;
  }
  box.appendChild(signalLine);

  const preview = el('div', 'sacn-preview');
  const moving = live && sacnStatus.moving === true;
  preview.appendChild(sacnPreviewRow(
    'Live FX',
    sacnStatus.colors,
    settings.sacn?.slots,
    fxLive ? (moving ? 'move' : 'hold') : null,
    { universe: fxUni, live: fxLive },
  ));
  preview.appendChild(sacnPreviewRow(
    'Static',
    sacnStatus.staticColors,
    settings.sacn?.staticSlots,
    null,
    { universe: lookUni, live: lookLive },
  ));
  box.appendChild(preview);

  if (live) box.classList.add('ableton-session--ok');
  else box.classList.add('ableton-session--warn');
  return box;
}

function nicSelect(name, value, nics) {
  const select = el('select', 'settings-input');
  select.name = name;
  const list = Array.isArray(nics) && nics.length
    ? nics
    : [{ name: 'All interfaces', address: '0.0.0.0' }];
  const current = value || '0.0.0.0';
  let found = false;
  for (const nic of list) {
    const label = nic.address === '0.0.0.0'
      ? nic.name
      : `${nic.name} (${nic.address})`;
    const opt = el('option', null, label);
    opt.value = nic.address;
    if (nic.address === current) {
      opt.selected = true;
      found = true;
    }
    select.appendChild(opt);
  }
  if (!found && current) {
    const opt = el('option', null, current);
    opt.value = current;
    opt.selected = true;
    select.appendChild(opt);
  }
  return select;
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

function destRow(dest = { host: '', port: 11010 }) {
  const row = el('div', 'oscout-dest-row');
  const host = textInput('oscOutHost', dest.host ?? '');
  host.placeholder = '192.168.10.40';
  host.setAttribute('aria-label', 'OSC destination host');
  const port = numberInput('oscOutPort', dest.port ?? 11010, { min: 1, max: 65535 });
  port.setAttribute('aria-label', 'OSC destination port');
  const remove = el('button', 'oscout-dest-remove', 'Remove');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(host);
  row.appendChild(port);
  row.appendChild(remove);
  return row;
}

function fallbackHttpPort() {
  if (typeof location === 'undefined') return 8080;
  const n = Number(location.port);
  if (Number.isInteger(n) && n > 0) return n;
  if (location.protocol === 'https:') return 443;
  return 80;
}

function shareFromInterfaces(data) {
  return shareFromNetResponse(data, {
    fallbackPort: fallbackHttpPort(),
    fallbackViews: FALLBACK_SHARE_VIEWS,
  });
}

function shareLinkRow(nic, viewId) {
  const row = el('div', nic.recommended ? 'share-link-row is-preferred' : 'share-link-row');
  row.dataset.role = 'share-link-row';
  row.dataset.origin = nic.origin;

  const meta = el('div', 'share-link-meta');
  meta.appendChild(el('span', 'share-link-nic', `${nic.name} · ${nic.address}`));
  if (nic.recommended) {
    meta.appendChild(el('span', 'share-link-badge', 'recommended'));
  }
  row.appendChild(meta);

  const actions = el('div', 'share-link-actions');
  const input = el('input');
  input.type = 'text';
  input.readOnly = true;
  input.className = 'settings-input share-link-url';
  input.dataset.role = 'share-url';
  input.value = shareUrl(nic.origin, viewId);
  input.setAttribute('aria-label', `Share URL for ${nic.name}`);
  input.addEventListener('focus', () => input.select());
  actions.appendChild(input);

  const btn = el('button', 'settings-sync share-link-copy', 'Copy');
  btn.type = 'button';
  btn.addEventListener('click', async () => {
    try {
      await copyTextToClipboard(input.value);
      btn.textContent = 'Copied';
      btn.classList.add('copied');
      window.setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 1200);
    } catch {
      input.focus();
      input.select();
      btn.textContent = 'Select';
      window.setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1600);
    }
  });
  actions.appendChild(btn);
  row.appendChild(actions);
  return row;
}

export function updateShareUrls(root, viewId) {
  if (!root) return;
  for (const row of root.querySelectorAll('[data-role="share-link-row"]')) {
    const origin = row.dataset.origin;
    const input = row.querySelector('[data-role="share-url"]');
    if (origin && input) input.value = shareUrl(origin, viewId);
  }
}

function renderSharePanel(share, shareViewId, onViewChange) {
  const group = el('fieldset', 'settings-group share-links');
  group.dataset.role = 'share-links';
  group.appendChild(el('legend', null, 'Operator links'));

  const hint = el('p', 'settings-sim-hint');
  hint.textContent = 'Copy a URL for phones and laptops on this network. If this box has two NICs, use the operator VLAN — not the Ableton Link VLAN.';
  group.appendChild(hint);

  const views = share?.views?.length ? share.views : listedViews(FALLBACK_SHARE_VIEWS);
  const selected = views.some((v) => v.id === shareViewId) ? shareViewId : defaultShareViewId(views);

  if (views.length) {
    const select = el('select', 'settings-input');
    select.setAttribute('aria-label', 'View to share');
    for (const view of views) {
      const opt = el('option', null, view.title ?? view.id);
      opt.value = view.id;
      if (view.id === selected) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => onViewChange?.(select.value));
    group.appendChild(fieldRow('View', select));
  }

  const origins = share?.origins ?? [];
  if (!origins.length) {
    const empty = el('p', 'settings-sim-hint share-links-empty');
    empty.textContent = 'No LAN address found. Connect this machine to the operator network, then reload Settings.';
    group.appendChild(empty);
    return group;
  }

  const list = el('div', 'share-link-list');
  for (const nic of origins) list.appendChild(shareLinkRow(nic, selected));
  group.appendChild(list);

  const portHint = el('p', 'settings-field-hint');
  const port = share?.port;
  portHint.textContent = Number.isInteger(port) && port > 0
    ? `HTTP port ${port} (HTTP_PORT in .env). Other devices need TCP ${port} to this IP.`
    : 'Other devices must reach this IP on the AbleView HTTP port.';
  group.appendChild(portHint);

  return group;
}

function oscOutStatusLine(oscOutStatus) {
  if (!oscOutStatus) return '';
  if (oscOutStatus.blocked) {
    const owner = oscOutStatus.owner;
    if (owner?.httpPort) {
      return `This process is not sending OSC. Port ${owner.httpPort} (pid ${owner.pid}) holds the lock. Run npm run stop-extras and use :8080.`;
    }
    return 'This process is not sending OSC. Another AbleView holds the lock. Run npm run stop-extras.';
  }
  if (oscOutStatus.sending) return `Sending from this process (pid ${oscOutStatus.pid}, port ${oscOutStatus.httpPort}).`;
  return '';
}

function renderOscOutGroup(settings, oscOutStatus) {
  const group = el('fieldset', 'settings-group');
  group.appendChild(el('legend', null, 'OSC clock out'));

  const enabled = settings.oscOut?.enabled === true;
  const check = el('input');
  check.type = 'checkbox';
  check.name = 'oscOutEnabled';
  check.id = 'oscOutEnabled';
  check.checked = enabled;
  check.className = 'settings-checkbox';
  const checkRow = el('div', 'settings-field settings-field-checkbox');
  checkRow.appendChild(check);
  const label = el('label', 'settings-checkbox-label');
  label.htmlFor = 'oscOutEnabled';
  label.textContent = 'Rebroadcast Live tempo, beat, bar, and transport over OSC';
  checkRow.appendChild(label);
  group.appendChild(checkRow);

  const dests = Array.isArray(settings.oscOut?.destinations) ? settings.oscOut.destinations : [];
  const listLabel = el('p', 'settings-label oscout-dest-heading', 'Destinations');
  group.appendChild(listLabel);

  const list = el('div', 'oscout-dest-list');
  list.dataset.role = 'oscout-destinations';
  if (dests.length === 0) {
    list.appendChild(destRow());
  } else {
    for (const dest of dests) list.appendChild(destRow(dest));
  }
  group.appendChild(list);

  const addRow = el('div', 'settings-sync-row');
  const addBtn = el('button', 'settings-sync', 'Add destination');
  addBtn.type = 'button';
  addBtn.addEventListener('click', () => {
    list.appendChild(destRow());
  });
  addRow.appendChild(addBtn);
  group.appendChild(addRow);

  const sendLine = oscOutStatusLine(oscOutStatus);
  if (sendLine) {
    const sendStatus = el('p', oscOutStatus?.blocked ? 'settings-status err' : 'settings-field-hint');
    sendStatus.textContent = sendLine;
    group.appendChild(sendStatus);
  }

  const hint = el('p', 'settings-sim-hint');
  hint.textContent = 'Each destination is a unicast UDP target (host + port). A 224–239.x multicast group is also allowed. Same messages go to every destination. This never sends toward Ableton. Leftover agent sims: npm run procs / npm run stop-extras.';
  group.appendChild(hint);

  const map = el('p', 'settings-field-hint oscout-addresses');
  map.textContent = '/ableview/clock/tempo  f   ·  /ableview/clock/beat  i (1-based in-bar)  ·  /ableview/clock/bar  i  ·  /ableview/clock/beat_pulse  i (1 then 0)  ·  /ableview/clock/bar_pulse  i (1 then 0)  ·  /ableview/clock/is_playing  i  ·  /ableview/clock/signature  i i  ·  Breath on /views/breath  ·  /ableview/breath/value  f  ·  /ableview/breath/phase  f  ·  /ableview/breath/cycle  i  ·  /ableview/breath/inhale  i  ·  /ableview/breath/exhale  i  ·  /ableview/breath/hold  i';
  group.appendChild(map);

  return group;
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
      includeArrangement: fd.get('includeArrangement') === 'on',
    },
    timecode: {
      enabled: fd.get('timecodeEnabled') === 'on',
      port: Number(fd.get('timecodePort')),
      bindAddress: fd.get('timecodeBindAddress')?.trim() ?? current.timecode?.bindAddress ?? '0.0.0.0',
      staleMs: Number(fd.get('timecodeStaleMs')),
    },
    sacn: sacnFromForm(fd, current),
    moments: {
      autoStartOnMoment: fd.get('momentsAutoStart') === 'on',
      kinds: (fd.get('momentsKinds')?.trim() ?? 'dope')
        .split(/[,\s]+/)
        .map((k) => k.trim())
        .filter(Boolean),
      debounceMs: Number(fd.get('momentsDebounceMs')),
    },
    oscOut: oscOutFromForm(fd),
  };
}

function slotGroupFromForm(fd, current, names) {
  return {
    main: {
      ...current.main,
      startChannel: Number(fd.get(names.main)),
    },
    secondary: {
      ...current.secondary,
      startChannel: Number(fd.get(names.secondary)),
    },
    accent: {
      ...current.accent,
      startChannel: Number(fd.get(names.accent)),
    },
  };
}

function sacnFromForm(fd, current) {
  const slots = current.sacn?.slots ?? SACN_DEFAULTS.slots;
  const staticSlots = current.sacn?.staticSlots ?? SACN_DEFAULTS.staticSlots;
  return {
    enabled: fd.get('sacnEnabled') === 'on',
    port: Number(fd.get('sacnPort')),
    interfaceAddress: fd.get('sacnInterfaceAddress')?.trim() || '0.0.0.0',
    universe: Number(fd.get('sacnUniverse')),
    staticUniverse: Number(fd.get('sacnStaticUniverse')),
    staleMs: Number(fd.get('sacnStaleMs')),
    multicast: true,
    ignorePreview: true,
    slots: slotGroupFromForm(fd, slots, {
      main: 'sacnMainChannel',
      secondary: 'sacnSecondaryChannel',
      accent: 'sacnAccentChannel',
    }),
    staticSlots: slotGroupFromForm(fd, staticSlots, {
      main: 'sacnStaticMainChannel',
      secondary: 'sacnStaticSecondaryChannel',
      accent: 'sacnStaticAccentChannel',
    }),
    log: {
      changeDelta: Number(fd.get('sacnChangeDelta')),
      settleMs: Number(fd.get('sacnSettleMs')),
      motionIntervalMs: current.sacn?.log?.motionIntervalMs ?? SACN_DEFAULTS.log.motionIntervalMs,
      minIntervalMs: current.sacn?.log?.minIntervalMs ?? SACN_DEFAULTS.log.minIntervalMs,
    },
  };
}

function oscOutFromForm(fd) {
  const hosts = fd.getAll('oscOutHost');
  const ports = fd.getAll('oscOutPort');
  const destinations = [];
  const count = Math.max(hosts.length, ports.length);
  for (let i = 0; i < count; i++) {
    const host = String(hosts[i] ?? '').trim();
    const portRaw = ports[i];
    if (!host) continue;
    destinations.push({ host, port: Number(portRaw) });
  }
  return {
    enabled: fd.get('oscOutEnabled') === 'on',
    destinations,
  };
}

function renderSacnGroup(settings, sacnStatus, nics) {
  const group = el('fieldset', 'settings-group');
  group.appendChild(el('legend', null, 'GrandMA colors (sACN)'));
  group.appendChild(renderSacnStatusBox(sacnStatus, settings));

  const enabled = settings.sacn?.enabled === true;
  const check = el('input');
  check.type = 'checkbox';
  check.name = 'sacnEnabled';
  check.id = 'sacnEnabled';
  check.checked = enabled;
  check.className = 'settings-checkbox';
  const row = el('div', 'settings-field settings-field-checkbox');
  row.appendChild(check);
  const label = el('label', 'settings-checkbox-label');
  label.htmlFor = 'sacnEnabled';
  label.textContent = 'Receive live RGB over sACN (E1.31)';
  row.appendChild(label);
  group.appendChild(row);

  group.appendChild(fieldRow(
    'Network interface',
    nicSelect('sacnInterfaceAddress', settings.sacn?.interfaceAddress ?? '0.0.0.0', nics),
  ));
  group.appendChild(fieldRow(
    'UDP port',
    numberInput('sacnPort', settings.sacn?.port ?? 5568, { min: 1, max: 65535 }),
  ));
  group.appendChild(el('p', 'settings-subhead', 'Live FX'));
  group.appendChild(fieldRow(
    'Universe',
    numberInput('sacnUniverse', settings.sacn?.universe ?? 191, { min: 1, max: 63999 }),
  ));
  group.appendChild(fieldRow(
    'Main',
    numberInput('sacnMainChannel', settings.sacn?.slots?.main?.startChannel ?? 500, { min: 1, max: 510 }),
  ));
  group.appendChild(fieldRow(
    'Secondary',
    numberInput('sacnSecondaryChannel', settings.sacn?.slots?.secondary?.startChannel ?? 503, { min: 1, max: 510 }),
  ));
  group.appendChild(fieldRow(
    'Accent',
    numberInput('sacnAccentChannel', settings.sacn?.slots?.accent?.startChannel ?? 506, { min: 1, max: 510 }),
  ));
  group.appendChild(el('p', 'settings-subhead', 'Static look'));
  group.appendChild(fieldRow(
    'Universe',
    numberInput('sacnStaticUniverse', settings.sacn?.staticUniverse ?? settings.sacn?.universe ?? 191, { min: 1, max: 63999 }),
  ));
  group.appendChild(fieldRow(
    'Main',
    numberInput('sacnStaticMainChannel', settings.sacn?.staticSlots?.main?.startChannel ?? 491, { min: 1, max: 510 }),
  ));
  group.appendChild(fieldRow(
    'Secondary',
    numberInput('sacnStaticSecondaryChannel', settings.sacn?.staticSlots?.secondary?.startChannel ?? 494, { min: 1, max: 510 }),
  ));
  group.appendChild(fieldRow(
    'Accent',
    numberInput('sacnStaticAccentChannel', settings.sacn?.staticSlots?.accent?.startChannel ?? 497, { min: 1, max: 510 }),
  ));
  group.appendChild(fieldRow(
    'Stale after (ms)',
    numberInput('sacnStaleMs', settings.sacn?.staleMs ?? 1000, { min: 0, step: 50 }),
  ));
  group.appendChild(fieldRow(
    'Log change delta (0–255)',
    numberInput('sacnChangeDelta', settings.sacn?.log?.changeDelta ?? 4, { min: 0, max: 255 }),
  ));
  group.appendChild(fieldRow(
    'Log settle (ms)',
    numberInput('sacnSettleMs', settings.sacn?.log?.settleMs ?? 200, { min: 0, step: 50 }),
  ));

  const hint = el('p', 'settings-sim-hint');
  hint.textContent = 'Pick the same NIC sACNView uses. Live FX defaults to Jake’s map (universe 191, channels 500–508). Static look can use a second universe — same NIC, one UDP port. Start channels are 1–510 on that universe. Operator cards paint FX; Flash and the session log use the static look, plus a MOVE span while FX is chasing. Preview packets are ignored.';
  group.appendChild(hint);
  return group;
}

function renderForm(root, settings, { onSave, onSync, status, sheetStatus, syncStatus, ingestStatus, timecodeStatus, sacnStatus, oscOutStatus, nics, share, shareViewId, onShareViewChange }) {
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

  const shareRow = el('div', 'settings-row settings-row-single share-links-row');
  shareRow.appendChild(renderSharePanel(share, shareViewId, onShareViewChange));
  root.appendChild(shareRow);

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

  const sacnRow = el('div', 'settings-row settings-row-single');
  sacnRow.appendChild(renderSacnGroup(settings, sacnStatus, nics));

  const momentsGroup = el('fieldset', 'settings-group');
  momentsGroup.appendChild(el('legend', null, 'Moments'));
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
    textInput('momentsKinds', (settings.moments?.kinds ?? ['dope', 'typed']).join(', ')),
  ));
  momentsGroup.appendChild(fieldRow(
    'Debounce (ms, 0 = off)',
    numberInput('momentsDebounceMs', settings.moments?.debounceMs ?? 0, { min: 0, step: 50 }),
  ));
  const momentsHint = el('p', 'settings-sim-hint');
  momentsHint.textContent = 'Dope on every view and notes on Set POST to /api/moments (same API as Companion Stream Deck buttons). When auto-start is on, the first tap creates a timestamp session name and updates operator views live. Moment count appears on the Set view log bar.';
  momentsGroup.appendChild(momentsHint);
  bottomRow.appendChild(momentsGroup);

  const matchGroup = el('fieldset', 'settings-group');
  matchGroup.appendChild(el('legend', null, 'Matching'));
  matchGroup.appendChild(fieldRow(
    'Confidence threshold (0–1)',
    numberInput('threshold', settings.match.threshold, { min: 0, max: 1, step: 0.05 })
  ));
  const includeArrCheck = el('input');
  includeArrCheck.type = 'checkbox';
  includeArrCheck.name = 'includeArrangement';
  includeArrCheck.id = 'includeArrangement';
  includeArrCheck.className = 'settings-checkbox';
  includeArrCheck.checked = settings.match?.includeArrangement === true;
  const includeArrRow = el('div', 'settings-field settings-field-checkbox');
  includeArrRow.appendChild(includeArrCheck);
  const includeArrLabel = el('label', 'settings-checkbox-label');
  includeArrLabel.htmlFor = 'includeArrangement';
  includeArrLabel.textContent = 'Match Arrangement-view clips';
  includeArrRow.appendChild(includeArrLabel);
  matchGroup.appendChild(includeArrRow);
  const matchHint = el('p', 'settings-sim-hint');
  matchHint.textContent = 'Leave Arrangement matching off for Session-view shows. Stopping a Session clip can fall back to a leftover Arrangement clip that is not in the mix. Generic clips (INTRO, LAYOUT, DROP) never match a song.';
  matchGroup.appendChild(matchHint);
  bottomRow.appendChild(matchGroup);

  const clockRow = el('div', 'settings-row settings-row-single');
  clockRow.appendChild(renderOscOutGroup(settings, oscOutStatus));

  grid.appendChild(topRow);
  grid.appendChild(bottomRow);
  grid.appendChild(sacnRow);
  grid.appendChild(clockRow);
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
  const root = typeof rootSelector === 'string'
    ? document.querySelector(rootSelector)
    : rootSelector;
  if (!root) return () => {};

  let settings = null;
  let status = null;
  let serverSupportsTimecode = true;
  let serverSupportsSacn = true;
  let sheetStatus = null;
  let syncStatus = null;
  let ingestStatus = null;
  let timecodeStatus = null;
  let sacnStatus = null;
  let oscOutStatus = null;
  let nics = [{ name: 'All interfaces', address: '0.0.0.0' }];
  let share = { port: 8080, views: [], origins: [] };
  let shareViewId = 'band';
  let pollTimer = null;
  let stopped = false;

  function render() {
    if (stopped) return;
    renderForm(root, settings, {
      onSave: save,
      onSync: syncSheet,
      status,
      sheetStatus,
      syncStatus,
      ingestStatus,
      timecodeStatus,
      sacnStatus,
      oscOutStatus,
      nics,
      share,
      shareViewId,
      onShareViewChange: (id) => {
        shareViewId = id;
        updateShareUrls(root, shareViewId);
      },
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

  function refreshSacnSessionBox() {
    const existing = root.querySelector('[data-role="sacn-session"]');
    if (!existing || !settings) return;
    const next = renderSacnStatusBox(sacnStatus, settings);
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
    if (data?.sacn) sacnStatus = data.sacn;
    if (data?.oscOut) oscOutStatus = data.oscOut;
  }

  async function loadNics() {
    try {
      const res = await fetch('/api/net/interfaces');
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.interfaces) && data.interfaces.length) nics = data.interfaces;
      share = shareFromInterfaces(data);
      if (!share.views.some((v) => v.id === shareViewId)) {
        shareViewId = defaultShareViewId(share.views);
      }
    } catch {
      // keep default
    }
  }

  async function load() {
    const res = await fetch('/api/config/settings');
    if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
    const data = await res.json();
    serverSupportsTimecode = data.settings?.timecode !== undefined;
    serverSupportsSacn = data.settings?.sacn !== undefined;
    settings = normalizeSettings(data.settings);
    if (data.oscOutStatus) oscOutStatus = data.oscOutStatus;
    await Promise.all([loadSheetStatus(), loadHealthStatus(), loadNics()]);
    if (!serverSupportsTimecode) {
      status = {
        ok: false,
        message: 'This AbleView process does not expose timecode settings yet — restart the server (npm start or your service), then reload this page.',
      };
    } else if (!serverSupportsSacn) {
      status = {
        ok: false,
        message: 'This AbleView process does not expose sACN color settings yet — restart the server (npm start or your service), then reload this page.',
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
    serverSupportsSacn = data.settings?.sacn !== undefined;
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
    if (patch.sacn && !data.reloaded?.includes('sacn')) {
      status = {
        ok: false,
        message: `Other settings saved, but sACN was not applied (reload list: ${data.reloaded?.join(', ') || 'none'}). Restart AbleView, reload this page, and save again.`,
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
    if (stopped) return;
    root.innerHTML = '';
    const errEl = el('div', 'settings-status err', err.message);
    root.appendChild(errEl);
  });

  pollTimer = setInterval(() => {
    if (stopped || !settings) return;
    const prevIngest = JSON.stringify(ingestStatus);
    const prevTimecode = JSON.stringify(timecodeStatus);
    const prevSacn = JSON.stringify(sacnStatus);
    loadHealthStatus()
      .then(() => {
        if (stopped) return;
        if (JSON.stringify(ingestStatus) !== prevIngest) refreshAbletonSessionBox();
        if (JSON.stringify(timecodeStatus) !== prevTimecode) refreshTimecodeSessionBox();
        if (JSON.stringify(sacnStatus) !== prevSacn) refreshSacnSessionBox();
      })
      .catch(() => {});
  }, 3000);
  pollTimer.unref?.();

  function applyLiveColors(status) {
    if (stopped || !status) return;
    sacnStatus = {
      ...(sacnStatus ?? {}),
      enabled: status.enabled === true,
      live: status.live === true,
      lastSeenAt: status.lastSeenAt ?? sacnStatus?.lastSeenAt ?? null,
      universe: status.universe ?? sacnStatus?.universe ?? null,
      staticUniverse: status.staticUniverse ?? sacnStatus?.staticUniverse ?? null,
      fxLive: status.fxLive === true,
      staticLive: status.staticLive === true,
      sourceName: status.sourceName ?? sacnStatus?.sourceName ?? null,
      sourceAddress: status.sourceAddress ?? sacnStatus?.sourceAddress ?? null,
      colors: status.colors ?? null,
      staticColors: status.staticColors ?? null,
      moving: status.moving === true,
    };
    refreshSacnSessionBox();
  }

  function unmount() {
    stopped = true;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    root.replaceChildren();
  }

  return { unmount, applyLiveColors };
}
