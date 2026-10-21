// Countdown module for operator views. Ticks locally from the last server clock sample.

import { describeTimer, projectClock, formatClockFace } from './show-clock.js';

const MODE_KEY = 'ableview.timer.mode';
const MODES = ['next', 'at', 'clock'];
const TICK_MS = 200;

let contextGetter = () => ({ sample: null, clientReceivedAt: 0, milestones: [] });

export function setShowTimerContext(getter) {
  contextGetter = typeof getter === 'function' ? getter : contextGetter;
}

export function readShowTimerContext() {
  try {
    return contextGetter() ?? { sample: null, clientReceivedAt: 0, milestones: [] };
  } catch {
    return { sample: null, clientReceivedAt: 0, milestones: [] };
  }
}

export function readTimerMode() {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (MODES.includes(stored)) return stored;
  } catch {
    // private mode / no storage
  }
  return 'next';
}

export function writeTimerMode(mode) {
  if (!MODES.includes(mode)) return;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
}

function paintTimerButton(button, field) {
  const ctx = readShowTimerContext();
  const view = describeTimer({
    sample: ctx.sample,
    clientReceivedAt: ctx.clientReceivedAt,
    milestones: ctx.milestones,
    mode: readTimerMode(),
    fallbackLabel: field?.label || 'Show',
  });
  button.className = 'timer-module';
  if (view.kind === 'overtime') button.classList.add('timer-module--over');
  button.dataset.timerKind = view.kind;
  const label = button.querySelector('[data-role="timer-label"]');
  const source = button.querySelector('[data-role="timer-source"]');
  const time = button.querySelector('[data-role="timer-time"]');
  if (label) label.textContent = view.label;
  if (source) source.textContent = view.source ?? '';
  if (time) time.textContent = view.primary;
  const spoken = view.source
    ? `${view.label}, ${view.primary}, ${view.source}`
    : `${view.label}, ${view.primary}`;
  button.setAttribute('aria-label', spoken);
}

function cycleMode(button, field) {
  const current = readTimerMode();
  const index = MODES.indexOf(current);
  const next = MODES[(index + 1) % MODES.length];
  writeTimerMode(next);
  paintTimerButton(button, field);
}

export function mountTimerModule(host, field) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'timer-module';
  button.title = 'Tap to cycle: countdown, milestone time, clock';

  const labelRow = document.createElement('span');
  labelRow.className = 'timer-module-label';
  const label = document.createElement('span');
  label.dataset.role = 'timer-label';
  const source = document.createElement('span');
  source.className = 'timer-source';
  source.dataset.role = 'timer-source';
  labelRow.append(label, source);

  const time = document.createElement('span');
  time.className = 'timer-module-time';
  time.dataset.role = 'timer-time';
  button.append(labelRow, time);
  button.addEventListener('click', () => cycleMode(button, field));
  host.replaceChildren(button);

  // Mount runs before the host is attached. Wait a microtask so the caller
  // can insert it, then keep painting only while it stays on the page.
  const tick = () => {
    if (!host.isConnected) return;
    paintTimerButton(button, field);
    setTimeout(tick, TICK_MS);
  };
  queueMicrotask(tick);
}

export function renderTimerStrip(fields) {
  const timers = (fields ?? []).filter((field) => field?.type === 'timer');
  if (!timers.length) return null;
  const strip = document.createElement('div');
  strip.className = 'timer-strip';
  for (const field of timers) {
    const host = document.createElement('div');
    host.className = 'timer-module-host';
    mountTimerModule(host, field);
    strip.appendChild(host);
  }
  return strip;
}

/** Show-box clock readout for the Set page. Stops when the node leaves the document. */
export function mountClockReadout(el) {
  const tick = () => {
    if (!el.isConnected) return;
    const ctx = readShowTimerContext();
    const clock = ctx.sample ? projectClock(ctx.sample, ctx.clientReceivedAt) : null;
    if (!clock) {
      el.textContent = 'Clock —';
    } else {
      const tag = clock.source === 'artnet' ? 'TC' : 'CLK';
      el.textContent = `${tag} ${formatClockFace(clock)}`;
    }
    setTimeout(tick, TICK_MS);
  };
  queueMicrotask(tick);
}

export function currentStampDisplay() {
  const ctx = readShowTimerContext();
  const clock = ctx.sample ? projectClock(ctx.sample, ctx.clientReceivedAt) : null;
  return clock?.display ?? null;
}
