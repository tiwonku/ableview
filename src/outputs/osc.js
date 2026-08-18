import osc from 'osc';
import { EVENTS } from '../core/bus.js';
import { liveTransportClock } from '../core/clock.js';

// Clock rebroadcast (spec §11 tap point). A separate UDP port from Ableton
// ingest — never send /live/** and never target ingest.abletonHost:oscSendPort.

export const OSC_OUT_ADDRESSES = Object.freeze({
  TEMPO: '/ableview/clock/tempo',
  BEAT: '/ableview/clock/beat',
  BAR: '/ableview/clock/bar',
  BEAT_PULSE: '/ableview/clock/beat_pulse',
  BAR_PULSE: '/ableview/clock/bar_pulse',
  IS_PLAYING: '/ableview/clock/is_playing',
  SIGNATURE: '/ableview/clock/signature',
});

export const OSC_OUT_PULSE_RESET_MS = 30;

function intArg(value) {
  return [{ type: 'i', value }];
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(value) {
  const n = finiteOrNull(value);
  return n == null ? null : Math.trunc(n);
}

export function isMulticastHost(host) {
  const parts = String(host ?? '').trim().split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return octets[0] >= 224 && octets[0] <= 239;
}

export function isAbletonDestination(dest, ingest) {
  if (!dest || !ingest) return false;
  return dest.host === ingest.abletonHost && Number(dest.port) === Number(ingest.oscSendPort);
}

export function resolveDestinations(oscOut, ingest) {
  const dests = [];
  const skippedAbleton = [];
  for (const raw of oscOut?.destinations ?? []) {
    const host = String(raw?.host ?? '').trim();
    const port = Number(raw?.port);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const dest = { host, port, multicast: isMulticastHost(host) };
    if (isAbletonDestination(dest, ingest)) {
      skippedAbleton.push(`${host}:${port}`);
      continue;
    }
    dests.push(dest);
  }
  return { destinations: dests, skippedAbleton };
}

/**
 * Diff previous clock state vs a NowPlaying event and return OSC packets.
 * On downbeat (beat-in-bar === 1), bar is sent before beat.
 * Pulse addresses (1) fire only on real ticks, never on snapshot.
 */
export function clockPackets(event, prev = null, { snapshot = false } = {}) {
  const prevSent = prev ?? {};
  const next = {
    tempo: finiteOrNull(event?.tempo),
    isPlaying: event?.isPlaying === true ? 1 : event?.isPlaying === false ? 0 : null,
    signatureNumerator: intOrNull(event?.signatureNumerator),
    signatureDenominator: intOrNull(event?.signatureDenominator),
    songBeat: finiteOrNull(event?.beat),
  };
  const live = liveTransportClock(
    next.songBeat,
    next.signatureNumerator ?? 4,
    next.signatureDenominator ?? 4,
  );
  next.bar = live.bar;
  next.beatInBar = live.beat;

  const packets = [];
  const changed = (key) => snapshot || prevSent[key] !== next[key];

  if (next.isPlaying != null && changed('isPlaying')) {
    packets.push({
      address: OSC_OUT_ADDRESSES.IS_PLAYING,
      args: [{ type: 'i', value: next.isPlaying }],
    });
  }
  if (next.tempo != null && changed('tempo')) {
    packets.push({
      address: OSC_OUT_ADDRESSES.TEMPO,
      args: [{ type: 'f', value: next.tempo }],
    });
  }
  if (
    next.signatureNumerator != null
    && next.signatureDenominator != null
    && (snapshot
      || prevSent.signatureNumerator !== next.signatureNumerator
      || prevSent.signatureDenominator !== next.signatureDenominator)
  ) {
    packets.push({
      address: OSC_OUT_ADDRESSES.SIGNATURE,
      args: [
        { type: 'i', value: next.signatureNumerator },
        { type: 'i', value: next.signatureDenominator },
      ],
    });
  }

  const beatTick = next.songBeat != null && (snapshot || prevSent.songBeat !== next.songBeat);
  const realBeatTick = !snapshot && next.songBeat != null && prevSent.songBeat !== next.songBeat;
  const barTick = next.bar != null && changed('bar');
  const beatInBarTick = next.beatInBar != null && (snapshot || prevSent.beatInBar !== next.beatInBar || beatTick);
  const pulses = { beat: false, bar: false };

  function pushBarNumber() {
    packets.push({ address: OSC_OUT_ADDRESSES.BAR, args: intArg(next.bar) });
  }
  function pushBeatNumber() {
    packets.push({ address: OSC_OUT_ADDRESSES.BEAT, args: intArg(next.beatInBar) });
  }
  function pushBarPulse() {
    packets.push({ address: OSC_OUT_ADDRESSES.BAR_PULSE, args: intArg(1) });
    pulses.bar = true;
  }
  function pushBeatPulse() {
    packets.push({ address: OSC_OUT_ADDRESSES.BEAT_PULSE, args: intArg(1) });
    pulses.beat = true;
  }

  if (beatTick && next.beatInBar === 1) {
    if (next.bar != null) {
      pushBarNumber();
      if (realBeatTick) pushBarPulse();
    }
    pushBeatNumber();
    if (realBeatTick) pushBeatPulse();
  } else {
    if (barTick) pushBarNumber();
    if (beatInBarTick) {
      pushBeatNumber();
      if (realBeatTick) pushBeatPulse();
    }
  }

  return { packets, sent: next, pulses };
}

export function createOscOutput({ getConfig, bus, log, sendPacket = null }) {
  let udp = null;
  let lastEvent = null;
  let lastSent = null;
  const pulseTimers = { beat: null, bar: null };

  function enabled() {
    return getConfig().oscOut?.enabled === true;
  }

  function pulseResetMs() {
    const n = getConfig().oscOut?.pulseResetMs;
    return Number.isFinite(n) && n >= 0 ? n : OSC_OUT_PULSE_RESET_MS;
  }

  function dispatch(packets) {
    if (!packets.length) return;
    const { destinations, skippedAbleton } = resolveDestinations(
      getConfig().oscOut,
      getConfig().ingest,
    );
    if (skippedAbleton.length) {
      log.warn({ skippedAbleton }, 'osc clock output skipped Ableton ingest destination (NFR-1)');
    }
    if (!destinations.length) return;

    for (const dest of destinations) {
      for (const packet of packets) {
        if (sendPacket) {
          sendPacket({ ...packet, host: dest.host, port: dest.port });
        } else if (udp) {
          udp.send({ address: packet.address, args: packet.args }, dest.host, dest.port);
        }
      }
    }
  }

  function pulseAddress(kind) {
    return kind === 'bar' ? OSC_OUT_ADDRESSES.BAR_PULSE : OSC_OUT_ADDRESSES.BEAT_PULSE;
  }

  function clearPulseTimer(kind, { reset = false } = {}) {
    if (!pulseTimers[kind]) return;
    clearTimeout(pulseTimers[kind]);
    pulseTimers[kind] = null;
    if (reset) dispatch([{ address: pulseAddress(kind), args: intArg(0) }]);
  }

  function clearPulseTimers({ reset = false } = {}) {
    clearPulseTimer('bar', { reset });
    clearPulseTimer('beat', { reset });
  }

  function schedulePulseReset(kind) {
    clearPulseTimer(kind);
    const timer = setTimeout(() => {
      pulseTimers[kind] = null;
      dispatch([{ address: pulseAddress(kind), args: intArg(0) }]);
    }, pulseResetMs());
    timer.unref?.();
    pulseTimers[kind] = timer;
  }

  function emitFromEvent(event, { snapshot = false } = {}) {
    if (!enabled()) return;
    if (!sendPacket && !udp) return;
    const { packets, sent, pulses } = clockPackets(event, snapshot ? null : lastSent, { snapshot });
    lastSent = sent;
    dispatch(packets);
    if (pulses.bar) schedulePulseReset('bar');
    if (pulses.beat) schedulePulseReset('beat');
  }

  function onNowPlaying(event) {
    lastEvent = event;
    emitFromEvent(event);
  }

  bus.on(EVENTS.NOW_PLAYING, onNowPlaying);

  async function openUdp() {
    udp = new osc.UDPPort({
      localAddress: '0.0.0.0',
      localPort: 0,
      metadata: true,
    });
    await new Promise((resolve, reject) => {
      udp.once('ready', resolve);
      udp.once('error', reject);
      udp.open();
    });
    udp.on('error', (err) => {
      log.error({ err: err.message }, 'osc clock output error');
    });
    const { destinations } = resolveDestinations(getConfig().oscOut, getConfig().ingest);
    if (destinations.some((d) => d.multicast) && typeof udp.socket?.setMulticastTTL === 'function') {
      udp.socket.setMulticastTTL(1);
    }
  }

  function closeUdp() {
    if (!udp) return;
    try {
      udp.close();
    } catch { /* already closed */ }
    udp = null;
  }

  async function start() {
    clearPulseTimers({ reset: true });
    closeUdp();
    lastSent = null;
    if (!enabled()) {
      log.info('osc clock output disabled');
      return;
    }
    if (!sendPacket) {
      await openUdp();
    }
    const { destinations } = resolveDestinations(getConfig().oscOut, getConfig().ingest);
    log.info({ destinations: destinations.length }, 'osc clock output ready');
    if (lastEvent) emitFromEvent(lastEvent, { snapshot: true });
  }

  function stop() {
    bus.off(EVENTS.NOW_PLAYING, onNowPlaying);
    clearPulseTimers({ reset: true });
    closeUdp();
  }

  return { start, stop };
}
