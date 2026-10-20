// GrandMA look sent only to 127.0.0.1. Never joins a multicast group.
// Look A / Look B are the static palettes the website logs as settled holds.
// FX stays a contrasting triple so the operator strip can still show motion.

import dgram from 'node:dgram';
import { buildE131DataPacket } from './e131.js';

export const COLOR_SIM_SOURCE_NAME = 'AbleView color sim';

export const COLOR_SIM_LOOK = Object.freeze({
  main: [255, 80, 0],
  secondary: [0, 40, 255],
  accent: [20, 200, 80],
});

export const COLOR_SIM_LOOK_B = Object.freeze({
  main: [40, 180, 255],
  secondary: [255, 40, 120],
  accent: [255, 255, 80],
});

/** Contrasting FX triple so the operator strip stays readable against either look. */
export const COLOR_SIM_FX = Object.freeze({
  main: [255, 0, 80],
  secondary: [80, 0, 255],
  accent: [255, 220, 0],
});

/** Long enough for the log settle window (default 200 ms) to write a hold. */
export const COLOR_SIM_ALTERNATE_MS = 4000;
export const COLOR_SIM_ALTERNATE_MIN_MS = 2000;
export const COLOR_SIM_ALTERNATE_MAX_MS = 120_000;

const SLOT_IDS = ['main', 'secondary', 'accent'];

function channelByte(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  return n;
}

/** [r, g, b] or null when the slot is missing or out of range. */
export function simRgb(raw) {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const rgb = raw.map(channelByte);
  if (rgb.some((n) => n == null)) return null;
  return rgb;
}

export function resolveSimPalette(raw, fallback) {
  const out = {};
  for (const id of SLOT_IDS) {
    out[id] = simRgb(raw?.[id]) ?? [...fallback[id]];
  }
  return out;
}

export function colorSimAlternateMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return COLOR_SIM_ALTERNATE_MS;
  return Math.min(COLOR_SIM_ALTERNATE_MAX_MS, Math.max(COLOR_SIM_ALTERNATE_MIN_MS, Math.round(n)));
}

/**
 * Look A, or Look B while alternate is on and the interval has elapsed.
 * `state` is `{ index, flippedAt }`, mutated so the caller keeps the phase.
 */
export function nextColorSimLook(sim, state, now) {
  const lookA = resolveSimPalette(sim?.look, COLOR_SIM_LOOK);
  const lookB = resolveSimPalette(sim?.lookB, COLOR_SIM_LOOK_B);
  if (sim?.alternate !== true) {
    state.index = 0;
    state.flippedAt = 0;
    return lookA;
  }
  const interval = colorSimAlternateMs(sim?.alternateMs);
  if (!state.flippedAt) {
    state.index = 0;
    state.flippedAt = now;
    return lookA;
  }
  if (now - state.flippedAt >= interval) {
    state.index = state.index === 0 ? 1 : 0;
    state.flippedAt = now;
  }
  return state.index === 0 ? lookA : lookB;
}

function writeRgb(dmx, startChannel, rgb) {
  const start = Number(startChannel);
  if (!rgb || !Number.isInteger(start) || start < 1) return;
  const i = start - 1;
  if (i + 2 >= dmx.length) return;
  dmx[i] = rgb[0];
  dmx[i + 1] = rgb[1];
  dmx[i + 2] = rgb[2];
}

export function colorSimIntervalMs(staleMs) {
  const stale = Number.isFinite(staleMs) && staleMs > 0 ? staleMs : 1000;
  return Math.min(400, Math.max(100, Math.floor(stale / 2)));
}

/** One DMX buffer: look channels and FX channels, using the listener's map. */
export function buildColorSimDmx(sacn, look = null) {
  const palette = look ?? resolveSimPalette(sacn?.sim?.look, COLOR_SIM_LOOK);
  const dmx = Buffer.alloc(512);
  for (const id of SLOT_IDS) {
    writeRgb(dmx, sacn?.staticSlots?.[id]?.startChannel, palette[id]);
    writeRgb(dmx, sacn?.slots?.[id]?.startChannel, COLOR_SIM_FX[id]);
  }
  return dmx;
}

export function colorSimUniverses(sacn) {
  const fx = Number.isInteger(sacn?.universe) ? sacn.universe : 191;
  const look = Number.isInteger(sacn?.staticUniverse) ? sacn.staticUniverse : fx;
  return [...new Set([fx, look])];
}

/**
 * Unicast E1.31 at 127.0.0.1 so the local listener paints Look and FX.
 * No-ops unless sacn.enabled and sacn.sim.enabled are both true.
 */
export function createSacnLoopback({
  getConfig,
  log,
  host = '127.0.0.1',
  unref = true,
} = {}) {
  let socket = null;
  let timer = null;
  let seq = 0;
  let running = false;
  const lookState = { index: 0, flippedAt: 0 };

  function sendOnce() {
    if (!socket) return;
    const sacn = getConfig?.()?.sacn ?? {};
    const port = sacn.port ?? 5568;
    const look = nextColorSimLook(sacn.sim, lookState, Date.now());
    const dmx = buildColorSimDmx(sacn, look);
    for (const universe of colorSimUniverses(sacn)) {
      const packet = buildE131DataPacket({
        universe,
        dmx,
        sourceName: COLOR_SIM_SOURCE_NAME,
        sequence: seq & 0xff,
      });
      socket.send(packet, port, host, () => {});
    }
    seq = (seq + 1) & 0xff;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (socket) {
      try { socket.close(); } catch { /* already closed */ }
      socket = null;
    }
    running = false;
  }

  function start() {
    const was = running;
    stop();
    lookState.index = 0;
    lookState.flippedAt = 0;
    const sacn = getConfig?.()?.sacn ?? {};
    if (sacn.enabled !== true || sacn.sim?.enabled !== true) {
      if (was) log?.info('sACN color sim stopped');
      return;
    }

    socket = dgram.createSocket('udp4');
    socket.on('error', (err) => {
      log?.warn({ err: err.message }, 'sACN color sim socket error');
    });
    running = true;
    const intervalMs = colorSimIntervalMs(sacn.staleMs);
    sendOnce();
    timer = setInterval(sendOnce, intervalMs);
    if (unref) timer.unref?.();
    log?.info(
      { host, port: sacn.port ?? 5568, universes: colorSimUniverses(sacn), intervalMs },
      'sACN color sim sending loopback',
    );
  }

  return {
    start,
    stop,
    sendOnce,
    get running() { return running; },
  };
}
