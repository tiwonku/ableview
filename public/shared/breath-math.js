// Shared breath envelope (Node OSC out + /views/breath preview).
// Song beat is Ableton quarter notes (same unit as NowPlaying.beat).

export const BREATH_CURVES = Object.freeze(['linear', 'easeIn', 'easeOut', 'easeInOut']);

export const DEFAULT_BREATH = Object.freeze({
  enabled: false,
  rateHz: 60,
  cycleBeats: 8,
  phaseOffsetBeats: 0,
  min: 0,
  max: 1,
  rise: 0.4,
  peakHold: 0.1,
  fall: 0.4,
  troughHold: 0.1,
  riseCurve: 'easeOut',
  fallCurve: 'easeIn',
});

export const INITIAL_BREATH_TRANSPORT = Object.freeze({
  songBeat: null,
  tempo: null,
  isPlaying: false,
  receivedAt: null,
  frozenBeat: null,
  signatureNumerator: 4,
  signatureDenominator: 4,
  lastIntBeat: null,
  lastSongTime: null,
});

/** Snap interpolator only for seeks, not for the same beat restated. */
export const BREATH_SEEK_BEATS = 1.5;
/** Ignore Ableton restates that are already within this window of the ramp. */
export const BREATH_HOLD_BEATS = 0.5;

function finiteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(value) {
  const n = finiteOr(value, 0);
  return Math.min(1, Math.max(0, n));
}

export function ease(t, curve) {
  const x = clamp01(t);
  switch (curve) {
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - ((-2 * x + 2) ** 2) / 2;
    default:
      return x;
  }
}

export function quartersPerBar(numerator = 4, denominator = 4) {
  const num = Number(numerator);
  const den = Number(denominator);
  if (!(num > 0 && den > 0)) return 4;
  const q = num * (4 / den);
  return q > 0 ? q : 4;
}

export function barsToBeats(bars, numerator = 4, denominator = 4) {
  return Number(bars) * quartersPerBar(numerator, denominator);
}

export function normalizeBreathSettings(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rise = Math.max(0, finiteOr(src.rise, DEFAULT_BREATH.rise));
  const peakHold = Math.max(0, finiteOr(src.peakHold, DEFAULT_BREATH.peakHold));
  const fall = Math.max(0, finiteOr(src.fall, DEFAULT_BREATH.fall));
  const troughHold = Math.max(0, finiteOr(src.troughHold, DEFAULT_BREATH.troughHold));
  let min = clamp01(src.min ?? DEFAULT_BREATH.min);
  let max = clamp01(src.max ?? DEFAULT_BREATH.max);
  if (max < min) {
    const swap = min;
    min = max;
    max = swap;
  }
  const riseCurve = BREATH_CURVES.includes(src.riseCurve) ? src.riseCurve : DEFAULT_BREATH.riseCurve;
  const fallCurve = BREATH_CURVES.includes(src.fallCurve) ? src.fallCurve : DEFAULT_BREATH.fallCurve;
  const rateHz = Math.min(60, Math.max(1, Math.round(finiteOr(src.rateHz, DEFAULT_BREATH.rateHz))));
  const cycleBeats = finiteOr(src.cycleBeats, DEFAULT_BREATH.cycleBeats);
  return {
    enabled: src.enabled === true,
    rateHz,
    cycleBeats: cycleBeats > 0 ? cycleBeats : DEFAULT_BREATH.cycleBeats,
    phaseOffsetBeats: finiteOr(src.phaseOffsetBeats, DEFAULT_BREATH.phaseOffsetBeats),
    min,
    max,
    rise,
    peakHold,
    fall,
    troughHold,
    riseCurve,
    fallCurve,
  };
}

export function normalizedWeights(settings) {
  const s = settings.rise != null ? settings : normalizeBreathSettings(settings);
  const raw = [s.rise, s.peakHold, s.fall, s.troughHold];
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return [0.25, 0.25, 0.25, 0.25];
  return raw.map((n) => n / sum);
}

export function breathPhase(songBeat, settings) {
  const s = settings.cycleBeats != null ? settings : normalizeBreathSettings(settings);
  const shifted = Number(songBeat) - s.phaseOffsetBeats;
  const cycleBeats = s.cycleBeats;
  const cycle = Math.floor(shifted / cycleBeats);
  let mod = shifted % cycleBeats;
  if (mod < 0) mod += cycleBeats;
  return { phase: cycleBeats > 0 ? mod / cycleBeats : 0, cycle };
}

export function envelopeAt(phase, settings) {
  const s = settings.riseCurve ? settings : normalizeBreathSettings(settings);
  const [riseW, peakW, fallW, troughW] = normalizedWeights(s);
  const p = clamp01(phase);
  const edges = [riseW, riseW + peakW, riseW + peakW + fallW, 1];
  let value01 = 0;
  let segment = 'troughHold';
  let inhale = 0;
  let exhale = 0;
  let hold = 0;

  if (p < edges[0] && riseW > 0) {
    segment = 'rise';
    inhale = 1;
    value01 = ease(p / riseW, s.riseCurve);
  } else if (p < edges[1] && peakW > 0) {
    segment = 'peakHold';
    hold = 1;
    value01 = 1;
  } else if (p < edges[2] && fallW > 0) {
    segment = 'fall';
    exhale = 1;
    const local = (p - edges[1]) / fallW;
    value01 = 1 - ease(local, s.fallCurve);
  } else {
    segment = 'troughHold';
    hold = troughW > 0 || (riseW === 0 && peakW === 0 && fallW === 0) ? 1 : 0;
    value01 = 0;
  }

  return {
    value: s.min + value01 * (s.max - s.min),
    inhale,
    exhale,
    hold,
    segment,
  };
}

export function idleBreathState(settings) {
  const s = normalizeBreathSettings(settings);
  return {
    value: s.min,
    phase: 0,
    cycle: 0,
    inhale: 0,
    exhale: 0,
    hold: 0,
    segment: null,
  };
}

export function breathAt(songBeat, settings) {
  const s = normalizeBreathSettings(settings);
  if (songBeat == null || !Number.isFinite(Number(songBeat))) return idleBreathState(s);
  const { phase, cycle } = breathPhase(Number(songBeat), s);
  return { ...envelopeAt(phase, s), phase, cycle };
}

export function sampleBreathWave(settings, steps = 128) {
  const s = normalizeBreathSettings(settings);
  const count = Math.max(2, Math.trunc(steps));
  const points = [];
  for (let i = 0; i <= count; i++) {
    const phase = i / count;
    const env = envelopeAt(phase, s);
    points.push({ phase, value: env.value, segment: env.segment });
  }
  return points;
}

export function interpolateSongBeat({
  songBeat,
  tempo,
  isPlaying,
  receivedAt,
  now,
  frozenBeat = null,
}) {
  if (isPlaying !== true) {
    if (frozenBeat != null && Number.isFinite(Number(frozenBeat))) return Number(frozenBeat);
    if (songBeat != null && Number.isFinite(Number(songBeat))) return Number(songBeat);
    return null;
  }
  if (songBeat == null || !Number.isFinite(Number(songBeat))) return null;
  const bpm = Number(tempo);
  if (!Number.isFinite(bpm) || bpm <= 0 || receivedAt == null) return Number(songBeat);
  const elapsedMs = Math.max(0, Number(now) - Number(receivedAt));
  return Number(songBeat) + (elapsedMs / 1000) * (bpm / 60);
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function currentInterp(state, now, playing = state.isPlaying) {
  return interpolateSongBeat({
    songBeat: state.songBeat,
    tempo: state.tempo,
    isPlaying: playing === true,
    receivedAt: state.receivedAt,
    now,
    frozenBeat: state.frozenBeat,
  });
}

function adopt(next, position, now, { freeze = false } = {}) {
  next.songBeat = position;
  next.receivedAt = now;
  next.frozenBeat = freeze ? position : null;
}

export function applyBreathTransport(prev, event, now) {
  const next = {
    songBeat: prev?.songBeat ?? null,
    tempo: prev?.tempo ?? null,
    isPlaying: prev?.isPlaying === true,
    receivedAt: prev?.receivedAt ?? null,
    frozenBeat: prev?.frozenBeat ?? null,
    signatureNumerator: prev?.signatureNumerator ?? 4,
    signatureDenominator: prev?.signatureDenominator ?? 4,
    lastIntBeat: prev?.lastIntBeat ?? null,
    lastSongTime: prev?.lastSongTime ?? null,
  };

  const tempoIn = finiteOrNull(event?.tempo);
  const tempoChanged = tempoIn != null && tempoIn !== next.tempo;
  if (tempoIn != null) next.tempo = tempoIn;

  const sigNum = finiteOrNull(event?.signatureNumerator);
  const sigDen = finiteOrNull(event?.signatureDenominator);
  if (sigNum != null) next.signatureNumerator = sigNum;
  if (sigDen != null) next.signatureDenominator = sigDen;

  const playingIn = event?.isPlaying;
  const playing = playingIn === true || playingIn === 1
    ? true
    : playingIn === false || playingIn === 0
      ? false
      : next.isPlaying;
  const wasPlaying = next.isPlaying === true;
  const songTime = finiteOrNull(event?.songTime);
  const intBeat = finiteOrNull(event?.beat);
  const incoming = songTime ?? intBeat;

  if (wasPlaying && !playing) {
    const pos = currentInterp(next, now, true);
    next.isPlaying = false;
    next.frozenBeat = pos;
    if (incoming != null && (pos == null || Math.abs(incoming - pos) > BREATH_SEEK_BEATS)) {
      adopt(next, incoming, now, { freeze: true });
    }
    if (intBeat != null) next.lastIntBeat = intBeat;
    if (songTime != null) next.lastSongTime = songTime;
    return next;
  }

  if (playing) {
    if (wasPlaying && tempoChanged) {
      const pos = currentInterp({ ...next, tempo: prev?.tempo }, now, true);
      if (pos != null) adopt(next, pos, now);
    }
    next.isPlaying = true;
    next.frozenBeat = null;

    const interp = currentInterp(next, now, true);

    if (songTime != null && songTime !== next.lastSongTime) {
      if (interp == null || Math.abs(songTime - interp) > BREATH_HOLD_BEATS) {
        adopt(next, songTime, now);
      }
      next.lastSongTime = songTime;
    } else if (songTime == null && intBeat != null && intBeat !== next.lastIntBeat) {
      if (interp == null || intBeat - interp > BREATH_HOLD_BEATS || interp - intBeat > BREATH_SEEK_BEATS) {
        adopt(next, intBeat, now);
      }
    }

    if (intBeat != null) next.lastIntBeat = intBeat;
    if (songTime != null) next.lastSongTime = songTime;
    return next;
  }

  next.isPlaying = false;
  if (incoming != null) {
    const current = next.frozenBeat ?? next.songBeat;
    if (current == null || Math.abs(incoming - current) > BREATH_SEEK_BEATS) {
      adopt(next, incoming, now, { freeze: true });
    }
  }
  if (intBeat != null) next.lastIntBeat = intBeat;
  if (songTime != null) next.lastSongTime = songTime;
  return next;
}
