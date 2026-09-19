import {
  DEFAULT_BREATH,
  applyBreathTransport,
  breathAt,
  interpolateSongBeat,
  normalizeBreathSettings,
} from '../../public/shared/breath-math.js';

export { DEFAULT_BREATH, normalizeBreathSettings };

export const BREATH_OSC_ADDRESSES = Object.freeze({
  VALUE: '/ableview/breath/value',
  PHASE: '/ableview/breath/phase',
  CYCLE: '/ableview/breath/cycle',
  INHALE: '/ableview/breath/inhale',
  EXHALE: '/ableview/breath/exhale',
  HOLD: '/ableview/breath/hold',
});

export const BREATH_FLOAT_EPS = 1e-4;

export function breathRateMs(settings) {
  const hz = normalizeBreathSettings(settings).rateHz;
  return 1000 / hz;
}

function floatArg(value) {
  return { type: 'f', value: Number(value) || 0 };
}

function intArg(value) {
  return { type: 'i', value: Number.isFinite(Number(value)) ? Math.trunc(value) : 0 };
}

export function normalizeBreathState(state) {
  return {
    value: Number(state?.value) || 0,
    phase: Number(state?.phase) || 0,
    cycle: Number.isFinite(Number(state?.cycle)) ? Math.trunc(state.cycle) : 0,
    inhale: state?.inhale === 1 ? 1 : 0,
    exhale: state?.exhale === 1 ? 1 : 0,
    hold: state?.hold === 1 ? 1 : 0,
  };
}

export function breathPackets(state) {
  const next = normalizeBreathState(state);
  return [
    { address: BREATH_OSC_ADDRESSES.VALUE, args: [floatArg(next.value)] },
    { address: BREATH_OSC_ADDRESSES.PHASE, args: [floatArg(next.phase)] },
    { address: BREATH_OSC_ADDRESSES.CYCLE, args: [intArg(next.cycle)] },
    { address: BREATH_OSC_ADDRESSES.INHALE, args: [intArg(next.inhale)] },
    { address: BREATH_OSC_ADDRESSES.EXHALE, args: [intArg(next.exhale)] },
    { address: BREATH_OSC_ADDRESSES.HOLD, args: [intArg(next.hold)] },
  ];
}

/** Named ints only on change; floats only when they move. No parent /ableview/breath (OscIn prefix collision). */
export function breathPacketDiff(state, prev = null, { epsilon = BREATH_FLOAT_EPS } = {}) {
  const next = normalizeBreathState(state);
  const packets = [];
  if (!prev || Math.abs(next.value - prev.value) > epsilon) {
    packets.push({ address: BREATH_OSC_ADDRESSES.VALUE, args: [floatArg(next.value)] });
  }
  if (!prev || Math.abs(next.phase - prev.phase) > epsilon) {
    packets.push({ address: BREATH_OSC_ADDRESSES.PHASE, args: [floatArg(next.phase)] });
  }
  if (!prev || next.cycle !== prev.cycle) {
    packets.push({ address: BREATH_OSC_ADDRESSES.CYCLE, args: [intArg(next.cycle)] });
  }
  if (!prev || next.inhale !== prev.inhale) {
    packets.push({ address: BREATH_OSC_ADDRESSES.INHALE, args: [intArg(next.inhale)] });
  }
  if (!prev || next.exhale !== prev.exhale) {
    packets.push({ address: BREATH_OSC_ADDRESSES.EXHALE, args: [intArg(next.exhale)] });
  }
  if (!prev || next.hold !== prev.hold) {
    packets.push({ address: BREATH_OSC_ADDRESSES.HOLD, args: [intArg(next.hold)] });
  }
  return { packets, sent: next };
}

function coalescePlaying(value, fallback = false) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return fallback === true;
}

function mergeNowPlaying(prev, event) {
  if (!event) return prev;
  const beat = Number.isFinite(Number(event.beat)) ? Number(event.beat) : prev?.beat;
  const songTime = Number.isFinite(Number(event.songTime)) ? Number(event.songTime) : prev?.songTime;
  const tempo = Number.isFinite(Number(event.tempo)) ? Number(event.tempo) : prev?.tempo;
  return {
    ...prev,
    ...event,
    beat: beat ?? null,
    songTime: songTime ?? null,
    tempo: tempo ?? null,
    isPlaying: coalescePlaying(event.isPlaying, prev?.isPlaying),
  };
}

function fallbackSongBeat(event) {
  const songTime = Number(event?.songTime);
  if (Number.isFinite(songTime)) return songTime;
  const beat = Number(event?.beat);
  return Number.isFinite(beat) ? beat : null;
}

export function createBreathRuntime({
  getSettings,
  dispatch,
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setIntervalFn = null,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
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
  let lastEvent = null;
  let lastSent = null;
  let timer = null;
  let timerKind = null;
  let lastPeriod = null;

  function onNowPlaying(event) {
    lastEvent = mergeNowPlaying(lastEvent, event);
    transport = applyBreathTransport(transport, lastEvent, now());
  }

  function tick() {
    const settings = normalizeBreathSettings(getSettings());
    if (!settings.enabled) return;
    const stamp = now();
    let songBeat = interpolateSongBeat({ ...transport, now: stamp });
    if (songBeat == null) songBeat = fallbackSongBeat(lastEvent);
    const { packets, sent } = breathPacketDiff(breathAt(songBeat, settings), lastSent);
    lastSent = sent;
    if (packets.length) dispatch(packets);
  }

  function stopTimer() {
    if (timer == null) return;
    if (timerKind === 'interval') clearIntervalFn(timer);
    else clearTimeoutFn(timer);
    timer = null;
    timerKind = null;
    lastPeriod = null;
  }

  function syncTimer(want) {
    if (!want) {
      stopTimer();
      lastSent = null;
      return;
    }
    const period = breathRateMs(getSettings());
    if (timer != null && lastPeriod === period) return;
    stopTimer();
    lastPeriod = period;
    if (setIntervalFn) {
      timerKind = 'interval';
      timer = setIntervalFn(tick, Math.round(period));
      timer?.unref?.();
      tick();
      return;
    }
    timerKind = 'timeout';
    let nextAt = now();
    const loop = () => {
      tick();
      nextAt += period;
      const delay = Math.max(0, nextAt - now());
      timer = setTimeoutFn(loop, delay);
      timer?.unref?.();
    };
    loop();
  }

  function stop() {
    syncTimer(false);
  }

  return { onNowPlaying, syncTimer, stop, tick };
}
