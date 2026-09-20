import {
  BREATH_CURVES,
  DEFAULT_BREATH,
  INITIAL_BREATH_TRANSPORT,
  applyBreathTransport,
  barsToBeats,
  breathAt,
  interpolateSongBeat,
  normalizeBreathSettings,
  quartersPerBar,
  sampleBreathWave,
} from './breath-math.js';

const SAVE_DEBOUNCE_MS = 250;
const BAR_PRESETS = [0.25, 0.5, 1, 2, 4];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatNum(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

function formatBarBeat(songBeat, num, den) {
  if (songBeat == null || !Number.isFinite(Number(songBeat))) return '—';
  const qpb = quartersPerBar(num, den);
  const sb = Number(songBeat);
  const bar = Math.floor(sb / qpb) + 1;
  const beat = (sb % qpb) + 1;
  return `${bar}.${formatNum(beat, 2)}`;
}

function settingsEqual(a, b) {
  const keys = Object.keys(DEFAULT_BREATH);
  return keys.every((k) => a[k] === b[k]);
}

async function fetchSettings() {
  const res = await fetch('/api/config/settings');
  if (!res.ok) throw new Error(`settings ${res.status}`);
  const body = await res.json();
  return {
    settings: body.settings ?? {},
    oscOutStatus: body.oscOutStatus ?? null,
  };
}

async function patchBreath(breath) {
  const res = await fetch('/api/config/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ oscOut: { breath } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `save failed (${res.status})`);
  return body;
}

const waveLayerCache = new WeakMap();

function wavePad(cssH, compact) {
  const showLabels = !compact || cssH >= 88;
  if (compact) return { l: 4, r: 4, t: 6, b: showLabels ? 14 : 6, showLabels };
  return { l: 8, r: 8, t: 12, b: 18, showLabels: true };
}

function waveSettingsKey(settings) {
  const s = normalizeBreathSettings(settings);
  return [
    s.min, s.max, s.rise, s.peakHold, s.fall, s.troughHold, s.riseCurve, s.fallCurve,
  ].join('|');
}

function syncCanvasLayout(canvas) {
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!(cssW >= 2) || !(cssH >= 2)) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { cssW, cssH, dpr, w, h };
}

function paintStaticWave(ctx, settings, cssW, cssH, compact) {
  const pad = wavePad(cssH, compact);
  const innerW = cssW - pad.l - pad.r;
  const innerH = cssH - pad.t - pad.b;
  const s = normalizeBreathSettings(settings);
  const points = sampleBreathWave(s, 160);
  const yAt = (value) => pad.t + innerH * (1 - value);

  const segments = [
    { name: 'rise', color: 'rgba(91, 141, 239, 0.12)' },
    { name: 'peakHold', color: 'rgba(62, 207, 142, 0.10)' },
    { name: 'fall', color: 'rgba(230, 162, 60, 0.12)' },
    { name: 'troughHold', color: 'rgba(139, 146, 168, 0.10)' },
  ];
  let x0 = pad.l;
  const weights = [
    [s.rise, 'rise'],
    [s.peakHold, 'peakHold'],
    [s.fall, 'fall'],
    [s.troughHold, 'troughHold'],
  ];
  const sum = weights.reduce((a, [n]) => a + n, 0) || 1;
  for (const [weight, name] of weights) {
    const width = innerW * (weight / sum);
    const fill = segments.find((seg) => seg.name === name)?.color;
    ctx.fillStyle = fill;
    ctx.fillRect(x0, pad.t, width, innerH);
    x0 += width;
  }

  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = pad.l + pt.phase * innerW;
    const y = yAt(pt.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.l + innerW, yAt(s.min));
  ctx.lineTo(pad.l, yAt(s.min));
  ctx.closePath();
  ctx.fillStyle = 'rgba(91, 141, 239, 0.22)';
  ctx.fill();

  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = pad.l + pt.phase * innerW;
    const y = yAt(pt.value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#5b8def';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.strokeStyle = 'rgba(240, 242, 248, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, yAt(s.min));
  ctx.lineTo(pad.l + innerW, yAt(s.min));
  ctx.moveTo(pad.l, yAt(s.max));
  ctx.lineTo(pad.l + innerW, yAt(s.max));
  ctx.stroke();

  if (pad.showLabels) {
    ctx.fillStyle = '#8b92a8';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('inhale', pad.l + 4, cssH - 4);
    ctx.fillText('exhale', pad.l + innerW * 0.52, cssH - 4);
  }
}

function paintPlayhead(ctx, cssW, cssH, playheadPhase, compact, dpr) {
  if (playheadPhase == null || !Number.isFinite(playheadPhase)) return;
  const pad = wavePad(cssH, compact);
  const innerW = cssW - pad.l - pad.r;
  const innerH = cssH - pad.t - pad.b;
  const x = Math.round((pad.l + clampPhase(playheadPhase) * innerW) * dpr) / dpr;
  ctx.strokeStyle = '#f0f2f8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, pad.t);
  ctx.lineTo(x, pad.t + innerH);
  ctx.stroke();
}

function ensureWaveLayer(canvas, settings, cssW, cssH, dpr, compact) {
  let entry = waveLayerCache.get(canvas);
  if (!entry) {
    entry = { layer: document.createElement('canvas'), key: '' };
    waveLayerCache.set(canvas, entry);
  }
  const key = `${Math.round(cssW * dpr)}x${Math.round(cssH * dpr)}|${compact ? 1 : 0}|${waveSettingsKey(settings)}`;
  if (entry.key === key) return entry.layer;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  entry.layer.width = w;
  entry.layer.height = h;
  const layerCtx = entry.layer.getContext('2d');
  if (!layerCtx) return null;
  layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layerCtx.clearRect(0, 0, cssW, cssH);
  paintStaticWave(layerCtx, settings, cssW, cssH, compact);
  entry.key = key;
  return entry.layer;
}

export function drawBreathWave(canvas, settings, playheadPhase, { compact = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const layout = syncCanvasLayout(canvas);
  if (!layout) return;
  const { cssW, cssH, dpr, w, h } = layout;
  const layer = ensureWaveLayer(canvas, settings, cssW, cssH, dpr, compact);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (layer) ctx.drawImage(layer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paintPlayhead(ctx, cssW, cssH, playheadPhase, compact, dpr);
}

function drawWave(canvas, settings, playheadPhase) {
  drawBreathWave(canvas, settings, playheadPhase);
}

function clampPhase(phase) {
  const n = Number(phase);
  if (!Number.isFinite(n)) return 0;
  return ((n % 1) + 1) % 1;
}

/**
 * Read-only Live-locked wave + playhead. Used on Admin dashboard Visuals.
 */
export function mountBreathPreview(host, { getPayload } = {}) {
  if (!host) throw new Error('Missing breath preview host');

  const wrap = el('div', 'breath-wave-wrap admin-dashboard-breath-wrap');
  const canvas = el('canvas', 'breath-wave admin-dashboard-breath-wave');
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas);

  let attachedHost = host;
  let parkNode = null;
  let parked = false;
  let settings = { ...DEFAULT_BREATH };
  let transport = { ...INITIAL_BREATH_TRANSPORT };
  let destroyed = false;
  let raf = 0;
  let lastBox = '';

  function applyPayload(payload) {
    if (!payload) return;
    transport = applyBreathTransport(transport, {
      tempo: payload.tempo,
      beat: payload.beat,
      songTime: payload.songTime,
      isPlaying: payload.isPlaying,
      signatureNumerator: payload.signatureNumerator,
      signatureDenominator: payload.signatureDenominator,
    }, Date.now());
  }

  function paint() {
    if (parked) return;
    const now = Date.now();
    const songBeat = interpolateSongBeat({ ...transport, now });
    const state = breathAt(songBeat, settings);
    drawBreathWave(canvas, settings, songBeat == null ? null : state.phase, { compact: true });
  }

  function loop() {
    if (destroyed) return;
    paint();
    raf = requestAnimationFrame(loop);
  }

  function attach(nextHost) {
    if (destroyed || !nextHost) return;
    parked = false;
    attachedHost = nextHost;
    if (wrap.parentNode !== nextHost) {
      nextHost.replaceChildren();
      nextHost.appendChild(wrap);
    }
    paint();
  }

  function park() {
    if (destroyed) return;
    parked = true;
    if (!parkNode) {
      parkNode = document.createElement('div');
      parkNode.hidden = true;
      parkNode.setAttribute('aria-hidden', 'true');
      document.body.appendChild(parkNode);
    }
    if (wrap.parentNode !== parkNode) parkNode.appendChild(wrap);
    attachedHost = parkNode;
  }

  attach(host);
  applyPayload(getPayload?.());
  paint();
  raf = requestAnimationFrame(loop);

  fetchSettings()
    .then((all) => {
      if (destroyed) return;
      settings = normalizeBreathSettings(all.settings?.oscOut?.breath ?? DEFAULT_BREATH);
      paint();
    })
    .catch(() => {
      // Keep defaults so the preview still runs offline.
    });

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
      if (destroyed || parked) return;
      const box = entries[0]?.contentRect;
      if (!box) return;
      const next = `${Math.round(box.width)}x${Math.round(box.height)}`;
      if (next === lastBox) return;
      lastBox = next;
      paint();
    })
    : null;
  ro?.observe(wrap);

  return {
    get host() {
      return attachedHost;
    },
    attach,
    park,
    updateTransport(payload) {
      applyPayload(payload);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      wrap.remove();
      parkNode?.remove();
      parkNode = null;
      attachedHost = null;
    },
  };
}

export function mountBreathPage(root, { getPayload } = {}) {
  if (!root) throw new Error('Missing breath root');
  root.replaceChildren();
  root.classList.add('breath-main');
  root.setAttribute('aria-label', 'Breath');

  let settings = { ...DEFAULT_BREATH };
  let oscOutEnabled = false;
  let destCount = 0;
  let transport = {
    songBeat: null,
    tempo: null,
    isPlaying: false,
    receivedAt: null,
    frozenBeat: null,
    signatureNumerator: 4,
    signatureDenominator: 4,
    lastIntBeat: null,
    lastSongTime: null,
  };
  let oscOutStatus = null;
  let saveTimer = null;
  let saveGen = 0;
  let saveState = 'idle';
  let saveError = null;
  let raf = null;
  let destroyed = false;

  const header = el('div', 'breath-header');
  const title = el('h1', 'breath-title', 'Breath');
  const enableLabel = el('label', 'breath-enable');
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.className = 'settings-checkbox';
  enable.id = 'breathEnabled';
  const enableText = el('span', null, 'Send over OSC');
  enableLabel.append(enable, enableText);
  header.append(title, enableLabel);

  const warn = el('p', 'breath-warn');
  warn.hidden = true;

  const meters = el('div', 'breath-meters');
  const meterEls = {
    value: el('p', 'stat-value', '—'),
    phase: el('p', 'stat-value', '—'),
    cycle: el('p', 'stat-value', '—'),
    gates: el('p', 'stat-value', '—'),
    clock: el('p', 'stat-value', '—'),
    frozen: el('p', 'stat-value', '—'),
  };
  function meter(label, node) {
    const box = el('div', 'stat');
    box.append(el('p', 'stat-label', label), node);
    return box;
  }
  meters.append(
    meter('Value', meterEls.value),
    meter('Phase', meterEls.phase),
    meter('Cycle', meterEls.cycle),
    meter('Gates', meterEls.gates),
    meter('Song', meterEls.clock),
    meter('Transport', meterEls.frozen),
  );

  const waveWrap = el('div', 'breath-wave-wrap');
  const canvas = document.createElement('canvas');
  canvas.className = 'breath-wave';
  canvas.setAttribute('aria-label', 'Breath waveform');
  waveWrap.appendChild(canvas);

  const form = el('div', 'breath-form');
  const saveLine = el('p', 'breath-save', '');

  function field(labelText, control, hint) {
    const row = el('div', 'settings-field settings-field-stacked');
    const lab = el('label', 'settings-label', labelText);
    row.append(lab, control);
    if (hint) row.append(el('p', 'settings-field-hint', hint));
    return row;
  }

  const rate = document.createElement('select');
  rate.className = 'settings-input';
  for (const hz of [30, 60]) {
    const opt = document.createElement('option');
    opt.value = String(hz);
    opt.textContent = `${hz} Hz`;
    rate.appendChild(opt);
  }

  const cycle = document.createElement('input');
  cycle.type = 'number';
  cycle.min = '0.25';
  cycle.step = '0.25';
  cycle.className = 'settings-input';

  const presets = el('div', 'breath-presets');
  for (const bars of BAR_PRESETS) {
    const btn = el('button', 'breath-preset', bars < 1 ? `${bars * 4}/4 bar` : `${bars} bar${bars === 1 ? '' : 's'}`);
    btn.type = 'button';
    btn.dataset.bars = String(bars);
    if (bars === 0.25) btn.textContent = '¼ bar';
    if (bars === 0.5) btn.textContent = '½ bar';
    presets.appendChild(btn);
  }

  const phase = document.createElement('input');
  phase.type = 'number';
  phase.step = '0.25';
  phase.className = 'settings-input';

  const phaseSlider = document.createElement('input');
  phaseSlider.type = 'range';
  phaseSlider.min = '-16';
  phaseSlider.max = '16';
  phaseSlider.step = '0.25';
  phaseSlider.className = 'breath-slider';

  const min = document.createElement('input');
  const max = document.createElement('input');
  min.type = max.type = 'number';
  min.min = max.min = '0';
  min.max = max.max = '1';
  min.step = max.step = '0.01';
  min.className = max.className = 'settings-input';

  function weightInput(name) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '2';
    input.step = '0.05';
    input.className = 'breath-slider';
    input.dataset.key = name;
    const num = document.createElement('input');
    num.type = 'number';
    num.min = '0';
    num.step = '0.05';
    num.className = 'settings-input breath-weight-num';
    num.dataset.key = name;
    const wrap = el('div', 'breath-weight-row');
    wrap.append(input, num);
    return { wrap, input, num };
  }

  const riseW = weightInput('rise');
  const peakW = weightInput('peakHold');
  const fallW = weightInput('fall');
  const troughW = weightInput('troughHold');

  function curveSelect() {
    const sel = document.createElement('select');
    sel.className = 'settings-input';
    for (const c of BREATH_CURVES) {
      const opt = document.createElement('option');
      opt.value = c;
      opt.textContent = c;
      sel.appendChild(opt);
    }
    return sel;
  }
  const riseCurve = curveSelect();
  const fallCurve = curveSelect();

  const clockGroup = el('fieldset', 'settings-group');
  clockGroup.append(
    el('legend', null, 'Clock'),
    field('Cycle length (beats)', cycle, 'Ableton quarter notes. Bar presets use the current time signature.'),
    field('Bar presets', presets),
    field('Phase offset (beats)', phase),
    field('Nudge', phaseSlider),
    field('Send rate', rate),
  );

  const shapeGroup = el('fieldset', 'settings-group');
  shapeGroup.append(
    el('legend', null, 'Shape'),
    field('Min', min),
    field('Max', max),
    field('Rise', riseW.wrap),
    field('Rise curve', riseCurve),
    field('Peak hold', peakW.wrap),
    field('Fall', fallW.wrap),
    field('Fall curve', fallCurve),
    field('Trough hold', troughW.wrap),
  );

  form.append(clockGroup, shapeGroup);

  const map = el(
    'p',
    'settings-field-hint breath-addresses',
    '/ableview/breath/value  f  ·  /ableview/breath/phase  f  ·  /ableview/breath/cycle  i  ·  /ableview/breath/inhale  i  ·  /ableview/breath/exhale  i  ·  /ableview/breath/hold  i',
  );

  root.append(header, warn, meters, waveWrap, saveLine, form, map);

  function readForm() {
    return normalizeBreathSettings({
      enabled: enable.checked,
      rateHz: Number(rate.value),
      cycleBeats: Number(cycle.value),
      phaseOffsetBeats: Number(phase.value),
      min: Number(min.value),
      max: Number(max.value),
      rise: Number(riseW.input.value),
      peakHold: Number(peakW.input.value),
      fall: Number(fallW.input.value),
      troughHold: Number(troughW.input.value),
      riseCurve: riseCurve.value,
      fallCurve: fallCurve.value,
    });
  }

  function writeForm(next) {
    const s = normalizeBreathSettings(next);
    enable.checked = s.enabled;
    rate.value = String(s.rateHz === 60 ? 60 : 30);
    cycle.value = String(s.cycleBeats);
    phase.value = String(s.phaseOffsetBeats);
    phaseSlider.value = String(s.phaseOffsetBeats);
    const span = Math.max(8, Math.abs(s.cycleBeats), Math.abs(s.phaseOffsetBeats));
    phaseSlider.min = String(-span);
    phaseSlider.max = String(span);
    min.value = String(s.min);
    max.value = String(s.max);
    riseW.input.value = riseW.num.value = String(s.rise);
    peakW.input.value = peakW.num.value = String(s.peakHold);
    fallW.input.value = fallW.num.value = String(s.fall);
    troughW.input.value = troughW.num.value = String(s.troughHold);
    riseCurve.value = s.riseCurve;
    fallCurve.value = s.fallCurve;
    settings = s;
  }

  function paintWarn() {
    if (oscOutStatus?.blocked) {
      const owner = oscOutStatus.owner;
      warn.hidden = false;
      warn.textContent = owner?.httpPort
        ? `This process is not sending OSC. Port ${owner.httpPort} (pid ${owner.pid}) holds the lock. Run npm run stop-extras and use :8080.`
        : 'This process is not sending OSC. Another AbleView holds the lock. Run npm run stop-extras and use :8080.';
      return;
    }
    if (!oscOutEnabled) {
      warn.hidden = false;
      warn.textContent = 'OSC clock out is off. Enable it and add destinations in Settings. Preview still runs here.';
      return;
    }
    if (destCount === 0) {
      warn.hidden = false;
      warn.textContent = 'No OSC destinations. Add a host/port in Settings so TouchDesigner sees clock + breath.';
      return;
    }
    if (!settings.enabled) {
      warn.hidden = false;
      warn.textContent = 'Breath OSC is off. Preview still follows Live; flip Send over OSC to publish.';
      return;
    }
    warn.hidden = true;
    warn.textContent = '';
  }

  function paintSave() {
    if (saveState === 'saving') saveLine.textContent = 'Saving…';
    else if (saveState === 'error') saveLine.textContent = saveError || 'Save failed';
    else if (saveState === 'saved') saveLine.textContent = 'Saved';
    else saveLine.textContent = '';
    saveLine.classList.toggle('is-error', saveState === 'error');
  }

  function scheduleSave() {
    saveState = 'saving';
    paintSave();
    if (saveTimer) clearTimeout(saveTimer);
    const gen = ++saveGen;
    const snapshot = { ...settings };
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        const result = await patchBreath(snapshot);
        if (gen !== saveGen) return;
        oscOutEnabled = result.settings?.oscOut?.enabled === true;
        destCount = Array.isArray(result.settings?.oscOut?.destinations)
          ? result.settings.oscOut.destinations.length
          : destCount;
        saveState = 'saved';
        saveError = null;
      } catch (err) {
        if (gen !== saveGen) return;
        saveState = 'error';
        saveError = err.message;
      }
      paintSave();
      paintWarn();
    }, SAVE_DEBOUNCE_MS);
  }

  function onFormChange() {
    const next = readForm();
    const changed = !settingsEqual(settings, next);
    settings = next;
    phaseSlider.value = String(next.phaseOffsetBeats);
    riseW.num.value = String(next.rise);
    peakW.num.value = String(next.peakHold);
    fallW.num.value = String(next.fall);
    troughW.num.value = String(next.troughHold);
    drawWave(canvas, settings, lastPhase);
    paintWarn();
    if (changed) scheduleSave();
  }

  function applyPayload(payload) {
    if (!payload) return;
    transport = applyBreathTransport(transport, {
      tempo: payload.tempo,
      beat: payload.beat,
      songTime: payload.songTime,
      isPlaying: payload.isPlaying,
      signatureNumerator: payload.signatureNumerator,
      signatureDenominator: payload.signatureDenominator,
    }, Date.now());
  }

  let lastPhase = 0;

  function paintLive() {
    const now = Date.now();
    const songBeat = interpolateSongBeat({ ...transport, now });
    const state = breathAt(songBeat, settings);
    lastPhase = state.phase;
    meterEls.value.textContent = formatNum(state.value, 3);
    meterEls.phase.textContent = formatNum(state.phase, 3);
    meterEls.cycle.textContent = String(state.cycle);
    const gates = [
      state.inhale ? 'inhale' : null,
      state.exhale ? 'exhale' : null,
      state.hold ? 'hold' : null,
    ].filter(Boolean);
    meterEls.gates.textContent = gates.join(' · ') || '—';
    meterEls.clock.textContent = formatBarBeat(
      songBeat,
      transport.signatureNumerator,
      transport.signatureDenominator,
    );
    const frozen = transport.isPlaying !== true && songBeat != null;
    meterEls.frozen.textContent = songBeat == null ? 'waiting' : transport.isPlaying ? 'playing' : 'frozen';
    meters.querySelectorAll('.stat')[5]?.classList.toggle('warn', frozen);
    drawWave(canvas, settings, songBeat == null ? null : state.phase);
  }

  function loop() {
    if (destroyed) return;
    paintLive();
    raf = requestAnimationFrame(loop);
  }

  enable.addEventListener('change', onFormChange);
  rate.addEventListener('change', onFormChange);
  cycle.addEventListener('input', onFormChange);
  phase.addEventListener('input', () => {
    phaseSlider.value = phase.value;
    onFormChange();
  });
  phaseSlider.addEventListener('input', () => {
    phase.value = phaseSlider.value;
    onFormChange();
  });
  min.addEventListener('input', onFormChange);
  max.addEventListener('input', onFormChange);
  riseCurve.addEventListener('change', onFormChange);
  fallCurve.addEventListener('change', onFormChange);
  for (const pair of [riseW, peakW, fallW, troughW]) {
    pair.input.addEventListener('input', () => {
      pair.num.value = pair.input.value;
      onFormChange();
    });
    pair.num.addEventListener('input', () => {
      pair.input.value = pair.num.value;
      onFormChange();
    });
  }
  presets.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-bars]');
    if (!btn) return;
    const bars = Number(btn.dataset.bars);
    cycle.value = String(barsToBeats(bars, transport.signatureNumerator, transport.signatureDenominator));
    onFormChange();
  });

  applyPayload(getPayload?.());
  writeForm(settings);
  paintWarn();
  paintSave();
  drawWave(canvas, settings, null);
  raf = requestAnimationFrame(loop);

  fetchSettings()
    .then((all) => {
      if (destroyed) return;
      oscOutEnabled = all.settings?.oscOut?.enabled === true;
      destCount = Array.isArray(all.settings?.oscOut?.destinations)
        ? all.settings.oscOut.destinations.length
        : 0;
      oscOutStatus = all.oscOutStatus ?? null;
      writeForm(all.settings?.oscOut?.breath ?? DEFAULT_BREATH);
      paintWarn();
    })
    .catch((err) => {
      saveState = 'error';
      saveError = err.message;
      paintSave();
    });

  return {
    updateTransport(payload) {
      applyPayload(payload);
    },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (saveTimer) clearTimeout(saveTimer);
      root.replaceChildren();
    },
  };
}
