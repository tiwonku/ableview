// Shared breath envelope (Node OSC out + /views/breath preview).
// Song beat is Ableton quarter notes (same unit as NowPlaying.beat).

export const BREATH_CURVES = Object.freeze(['linear', 'easeIn', 'easeOut', 'easeInOut']);
export const BREATH_POWER_MIN = 1;
export const BREATH_POWER_MAX = 8;

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
  risePower: 2,
  fallPower: 2,
  riseStraight: 0,
  fallStraight: 0,
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

export function clampBreathPower(value, fallback = DEFAULT_BREATH.risePower) {
  const n = finiteOr(value, fallback);
  return Math.min(BREATH_POWER_MAX, Math.max(BREATH_POWER_MIN, n));
}

function easeFull(x, curve, power) {
  switch (curve) {
    case 'easeIn':
      return x ** power;
    case 'easeOut':
      return 1 - (1 - x) ** power;
    case 'easeInOut':
      return x < 0.5 ? (2 ** (power - 1)) * (x ** power) : 1 - ((-2 * x + 2) ** power) / 2;
    default:
      return x;
  }
}

function cubeBez(s, p1, p2) {
  const inv = 1 - s;
  return 3 * inv * inv * s * p1 + 3 * inv * s * s * p2 + s * s * s;
}

function cubeBezDeriv(s, p1, p2) {
  const inv = 1 - s;
  return 3 * inv * inv * p1 + 6 * inv * s * (p2 - p1) + 3 * s * s * (1 - p2);
}

/** Unit cubic-bezier (0,0)→(1,1). Handles are (x1,y1) and (x2,y2). */
function cubicBezierEase(t, x1, y1, x2, y2) {
  const x = clamp01(t);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const dx = cubeBezDeriv(s, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    s -= (cubeBez(s, x1, x2) - x) / dx;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  }
  return clamp01(cubeBez(s, y1, y2));
}

/**
 * straight > 0 replaces the power curve with one cubic bezier:
 * handles sit closer to the ends as straight increases (straighter middle),
 * tightness tips the handles off the diagonal (sharper ease, still one curve).
 */
export function ease(t, curve, power = DEFAULT_BREATH.risePower, straight = 0) {
  const x = clamp01(t);
  const p = clampBreathPower(power);
  const mid = clamp01(straight);
  if (curve === 'linear' || curve == null) return x;
  if (mid <= 0) return easeFull(x, curve, p);
  if (mid >= 1) return x;

  const c = Math.max(1e-4, (1 - mid) / 2);
  const k = (p - BREATH_POWER_MIN) / (BREATH_POWER_MAX - BREATH_POWER_MIN);
  const lift = 1 - k;
  if (curve === 'easeIn') {
    return cubicBezierEase(x, c, c * lift, 1, 1);
  }
  if (curve === 'easeOut') {
    return cubicBezierEase(x, 0, 0, 1 - c, 1 - c * lift);
  }
  return cubicBezierEase(x, c, c * lift, 1 - c, 1 - c * lift);
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

/** Offset that puts inhale (phase 0) at songBeat, wrapped into [0, cycleBeats). */
export function phaseOffsetForInhaleAt(songBeat, cycleBeats) {
  if (songBeat == null || songBeat === '') return null;
  const beat = Number(songBeat);
  const cycle = Number(cycleBeats);
  if (!Number.isFinite(beat) || !(cycle > 0)) return null;
  let offset = beat % cycle;
  if (offset < 0) offset += cycle;
  return Number(offset.toFixed(4));
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
  const risePower = clampBreathPower(src.risePower, DEFAULT_BREATH.risePower);
  const fallPower = clampBreathPower(src.fallPower, DEFAULT_BREATH.fallPower);
  const riseStraight = clamp01(src.riseStraight ?? DEFAULT_BREATH.riseStraight);
  const fallStraight = clamp01(src.fallStraight ?? DEFAULT_BREATH.fallStraight);
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
    risePower,
    fallPower,
    riseStraight,
    fallStraight,
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
    value01 = ease(p / riseW, s.riseCurve, s.risePower, s.riseStraight);
  } else if (p < edges[1] && peakW > 0) {
    segment = 'peakHold';
    hold = 1;
    value01 = 1;
  } else if (p < edges[2] && fallW > 0) {
    segment = 'fall';
    exhale = 1;
    const local = (p - edges[1]) / fallW;
    value01 = 1 - ease(local, s.fallCurve, s.fallPower, s.fallStraight);
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
