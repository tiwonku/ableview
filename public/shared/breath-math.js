// Shared breath envelope (Node OSC out + /views/breath preview).
// Song beat is Ableton quarter notes (same unit as NowPlaying.beat).

export const BREATH_CURVES = Object.freeze(['linear', 'easeIn', 'easeOut', 'easeInOut']);

export const DEFAULT_BREATH = Object.freeze({
  enabled: false,
  rateHz: 30,
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
});

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

export function applyBreathTransport(prev, event, now) {
  const next = {
    songBeat: prev?.songBeat ?? null,
    tempo: prev?.tempo ?? null,
    isPlaying: prev?.isPlaying === true,
    receivedAt: prev?.receivedAt ?? null,
    frozenBeat: prev?.frozenBeat ?? null,
    signatureNumerator: prev?.signatureNumerator ?? 4,
    signatureDenominator: prev?.signatureDenominator ?? 4,
  };

  const tempoIn = event?.tempo;
  const tempoChanged = tempoIn != null && Number.isFinite(Number(tempoIn)) && Number(tempoIn) !== next.tempo;
  if (tempoIn != null && Number.isFinite(Number(tempoIn))) next.tempo = Number(tempoIn);

  if (event?.signatureNumerator != null && Number.isFinite(Number(event.signatureNumerator))) {
    next.signatureNumerator = Number(event.signatureNumerator);
  }
  if (event?.signatureDenominator != null && Number.isFinite(Number(event.signatureDenominator))) {
    next.signatureDenominator = Number(event.signatureDenominator);
  }

  const playing = event?.isPlaying === true;
  const wasPlaying = next.isPlaying === true;
  const beatIn = event?.beat;
  const hasBeat = beatIn != null && Number.isFinite(Number(beatIn));
  const beatChanged = hasBeat && Number(beatIn) !== next.songBeat;

  if (wasPlaying && !playing) {
    next.frozenBeat = interpolateSongBeat({
      songBeat: next.songBeat,
      tempo: next.tempo,
      isPlaying: true,
      receivedAt: next.receivedAt,
      now,
    });
    next.isPlaying = false;
    if (hasBeat && next.songBeat != null && Math.abs(Number(beatIn) - Number(next.songBeat)) > 1.5) {
      next.songBeat = Number(beatIn);
      next.frozenBeat = Number(beatIn);
    }
    return next;
  }

  if (playing) {
    if (wasPlaying && tempoChanged && !beatChanged) {
      next.songBeat = interpolateSongBeat({
        songBeat: next.songBeat,
        tempo: prev?.tempo,
        isPlaying: true,
        receivedAt: next.receivedAt,
        now,
      });
      next.receivedAt = now;
    }
    next.isPlaying = true;
    next.frozenBeat = null;
    if (hasBeat) {
      next.songBeat = Number(beatIn);
      next.receivedAt = now;
    }
    return next;
  }

  next.isPlaying = false;
  if (hasBeat) {
    next.songBeat = Number(beatIn);
    next.frozenBeat = Number(beatIn);
  }
  return next;
}
