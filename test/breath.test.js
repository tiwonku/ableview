import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBreathTransport,
  barsToBeats,
  breathAt,
  ease,
  interpolateSongBeat,
  normalizeBreathSettings,
  phaseOffsetForInhaleAt,
  quartersPerBar,
} from '../public/shared/breath-math.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';
import { createBus, EVENTS } from '../src/core/bus.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { createLogger } from '../src/core/logger.js';
import { BREATH_OSC_ADDRESSES, breathPacketDiff, breathPackets, breathRateMs } from '../src/outputs/breath.js';
import { createOscOutput, toOscBundle } from '../src/outputs/osc.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function shape(overrides = {}) {
  return normalizeBreathSettings({
    enabled: true,
    cycleBeats: 4,
    phaseOffsetBeats: 0,
    min: 0,
    max: 1,
    rise: 1,
    peakHold: 1,
    fall: 1,
    troughHold: 1,
    riseCurve: 'linear',
    fallCurve: 'linear',
    ...overrides,
  });
}

test('ease curves stay in 0–1', () => {
  for (const curve of ['linear', 'easeIn', 'easeOut', 'easeInOut']) {
    for (const power of [1, 2, 4, 8]) {
      assert.equal(ease(0, curve, power), 0);
      assert.equal(ease(1, curve, power), 1);
      assert.ok(ease(0.5, curve, power) >= 0 && ease(0.5, curve, power) <= 1);
    }
  }
  assert.equal(ease(0.5, 'linear'), 0.5);
});

test('ease power 2 matches quadratic and higher power tightens the knee', () => {
  assert.equal(ease(0.5, 'easeIn', 2), 0.25);
  assert.equal(ease(0.5, 'easeOut', 2), 0.75);
  assert.equal(ease(0.25, 'easeInOut', 2), 0.125);
  assert.equal(ease(0.5, 'easeIn', 1), 0.5);
  assert.equal(ease(0.5, 'easeIn', 4), 0.0625);
  assert.ok(ease(0.5, 'easeIn', 4) < ease(0.5, 'easeIn', 2));
  assert.ok(ease(0.5, 'easeOut', 4) > ease(0.5, 'easeOut', 2));
  assert.equal(ease(0.5, 'linear', 8), 0.5);
});

test('normalizeBreathSettings defaults and clamps curve power', () => {
  assert.equal(normalizeBreathSettings({}).risePower, 2);
  assert.equal(normalizeBreathSettings({}).fallPower, 2);
  assert.equal(normalizeBreathSettings({ risePower: 0 }).risePower, 1);
  assert.equal(normalizeBreathSettings({ fallPower: 99 }).fallPower, 8);
  assert.equal(normalizeBreathSettings({}).riseStraight, 0);
  assert.equal(normalizeBreathSettings({ fallStraight: 4 }).fallStraight, 1);
});

test('straight mid is a smooth bezier toward a linear ramp', () => {
  assert.equal(ease(0, 'easeInOut', 2, 0.5), 0);
  assert.equal(ease(1, 'easeInOut', 2, 0.5), 1);
  assert.ok(Math.abs(ease(0.5, 'easeInOut', 2, 0.5) - 0.5) < 1e-5);
  const full = ease(0.25, 'easeInOut', 2, 0);
  const bent = ease(0.25, 'easeInOut', 2, 0.5);
  assert.ok(Math.abs(bent - 0.25) < Math.abs(full - 0.25));
  assert.equal(ease(0.4, 'easeInOut', 2, 0), ease(0.4, 'easeInOut', 2));
  assert.equal(ease(0.2, 'easeInOut', 2, 1), 0.2);
  assert.ok(ease(0.12, 'easeInOut', 8, 0.5) > 0.03);
});

test('rise and fall power change envelope shape', () => {
  const loose = shape({ riseCurve: 'easeIn', risePower: 1, fallCurve: 'easeIn', fallPower: 1 });
  const tight = shape({ riseCurve: 'easeIn', risePower: 4, fallCurve: 'easeIn', fallPower: 4 });
  assert.ok(breathAt(0.5, tight).value < breathAt(0.5, loose).value);
  assert.ok(breathAt(2.5, tight).value > breathAt(2.5, loose).value);
});

test('inhale exhale and hold stay latched for the whole segment', () => {
  const s = shape({ cycleBeats: 4, rise: 1, peakHold: 1, fall: 1, troughHold: 1 });
  for (let beat = 0; beat < 1; beat += 0.1) {
    assert.equal(breathAt(beat, s).inhale, 1, `inhale at ${beat}`);
    assert.equal(breathAt(beat, s).exhale, 0);
    assert.equal(breathAt(beat, s).hold, 0);
  }
  for (let beat = 1; beat < 2; beat += 0.1) {
    assert.equal(breathAt(beat, s).hold, 1, `peak hold at ${beat}`);
    assert.equal(breathAt(beat, s).inhale, 0);
  }
  for (let beat = 2; beat < 3; beat += 0.1) {
    assert.equal(breathAt(beat, s).exhale, 1, `exhale at ${beat}`);
    assert.equal(breathAt(beat, s).inhale, 0);
    assert.equal(breathAt(beat, s).hold, 0);
  }
  for (let beat = 3; beat < 4; beat += 0.1) {
    assert.equal(breathAt(beat, s).hold, 1, `trough hold at ${beat}`);
    assert.equal(breathAt(beat, s).exhale, 0);
  }
});

test('breathAt maps equal segments and latched gates', () => {
  const s = shape();
  const rise = breathAt(0.5, s);
  assert.equal(rise.inhale, 1);
  assert.equal(rise.exhale, 0);
  assert.equal(rise.hold, 0);
  assert.ok(rise.value > 0 && rise.value < 1);

  const peak = breathAt(1.25, s);
  assert.equal(peak.hold, 1);
  assert.equal(peak.value, 1);

  const fall = breathAt(2.5, s);
  assert.equal(fall.exhale, 1);
  assert.equal(fall.inhale, 0);

  const trough = breathAt(3.25, s);
  assert.equal(trough.hold, 1);
  assert.equal(trough.value, 0);
  assert.equal(trough.cycle, 0);

  const next = breathAt(4, s);
  assert.equal(next.cycle, 1);
  assert.equal(next.phase, 0);
});

test('phase offset shifts the envelope against song beat', () => {
  const aligned = breathAt(0, shape({ phaseOffsetBeats: 0, rise: 1, peakHold: 0, fall: 0, troughHold: 0 }));
  const shifted = breathAt(0, shape({ phaseOffsetBeats: 1, rise: 1, peakHold: 0, fall: 0, troughHold: 0, cycleBeats: 4 }));
  assert.equal(aligned.phase, 0);
  assert.equal(shifted.phase, 0.75);
});

test('phaseOffsetForInhaleAt wraps song beat into one cycle', () => {
  assert.equal(phaseOffsetForInhaleAt(12, 8), 4);
  assert.equal(phaseOffsetForInhaleAt(4, 8), 4);
  assert.equal(phaseOffsetForInhaleAt(-1, 8), 7);
  assert.equal(phaseOffsetForInhaleAt(null, 8), null);
  assert.equal(phaseOffsetForInhaleAt(3, 0), null);
  const songBeat = 12.25;
  const offset = phaseOffsetForInhaleAt(songBeat, 8);
  const aligned = breathAt(songBeat, shape({
    cycleBeats: 8,
    phaseOffsetBeats: offset,
    rise: 1,
    peakHold: 0,
    fall: 0,
    troughHold: 0,
  }));
  assert.equal(aligned.phase, 0);
  assert.equal(aligned.inhale, 1);
});

test('min/max scale the 0–1 envelope', () => {
  const s = shape({ min: 0.2, max: 0.8, rise: 0, peakHold: 1, fall: 0, troughHold: 0 });
  assert.equal(breathAt(0.5, s).value, 0.8);
  const low = shape({ min: 0.2, max: 0.8, rise: 0, peakHold: 0, fall: 0, troughHold: 1 });
  assert.equal(breathAt(0.5, low).value, 0.2);
});

test('null song beat is idle at min', () => {
  const idle = breathAt(null, shape({ min: 0.1 }));
  assert.equal(idle.value, 0.1);
  assert.equal(idle.cycle, 0);
  assert.equal(idle.inhale, 0);
});

test('interpolateSongBeat advances while playing and freezes when stopped', () => {
  const playing = interpolateSongBeat({
    songBeat: 0,
    tempo: 120,
    isPlaying: true,
    receivedAt: 0,
    now: 500,
  });
  assert.equal(playing, 1);

  const frozen = interpolateSongBeat({
    songBeat: 0,
    tempo: 120,
    isPlaying: false,
    receivedAt: 0,
    now: 500,
    frozenBeat: 1.25,
  });
  assert.equal(frozen, 1.25);
});

test('applyBreathTransport freezes interpolated position when Live stops', () => {
  let t = applyBreathTransport(null, {
    beat: 0,
    tempo: 120,
    isPlaying: true,
  }, 0);
  t = applyBreathTransport(t, {
    beat: 0,
    tempo: 120,
    isPlaying: false,
  }, 500);
  assert.equal(t.isPlaying, false);
  assert.equal(t.frozenBeat, 1);
  assert.equal(interpolateSongBeat({ ...t, now: 2000 }), 1);
});

test('applyBreathTransport does not rewind when the same integer beat is restated', () => {
  let t = applyBreathTransport(null, {
    beat: 0,
    tempo: 120,
    isPlaying: true,
  }, 0);
  t = applyBreathTransport(t, {
    beat: 0,
    tempo: 120,
    isPlaying: true,
  }, 400);
  assert.equal(interpolateSongBeat({ ...t, now: 400 }), 0.8);
});

test('applyBreathTransport keeps ramping across the next integer beat when already close', () => {
  let t = applyBreathTransport(null, {
    beat: 0,
    tempo: 120,
    isPlaying: true,
  }, 0);
  t = applyBreathTransport(t, {
    beat: 1,
    tempo: 120,
    isPlaying: true,
  }, 480);
  const pos = interpolateSongBeat({ ...t, now: 480 });
  assert.ok(pos > 0.9 && pos < 1.05, `expected ~0.96, got ${pos}`);
});

test('applyBreathTransport adopts songTime when it jumps', () => {
  let t = applyBreathTransport(null, {
    beat: 8,
    songTime: 8,
    tempo: 100,
    isPlaying: true,
  }, 0);
  t = applyBreathTransport(t, {
    beat: 24,
    songTime: 24.25,
    tempo: 100,
    isPlaying: true,
  }, 20);
  assert.equal(interpolateSongBeat({ ...t, now: 20 }), 24.25);
});

test('applyBreathTransport keeps playing when isPlaying is omitted', () => {
  let t = applyBreathTransport(null, {
    beat: 0,
    tempo: 120,
    isPlaying: true,
  }, 0);
  t = applyBreathTransport(t, {
    beat: 1,
    tempo: 120,
  }, 500);
  assert.equal(t.isPlaying, true);
  const pos = interpolateSongBeat({ ...t, now: 500 });
  assert.ok(pos > 0.9, `expected ramp to continue, got ${pos}`);
});

test('applyBreathTransport jumps frozen beat when arrangement position jumps while stopped', () => {
  let t = applyBreathTransport(null, {
    beat: 8,
    tempo: 100,
    isPlaying: false,
  }, 0);
  assert.equal(t.frozenBeat, 8);
  t = applyBreathTransport(t, {
    beat: 24,
    tempo: 100,
    isPlaying: false,
  }, 10);
  assert.equal(t.frozenBeat, 24);
});

test('barsToBeats follows time signature (Ableton quarter notes)', () => {
  assert.equal(quartersPerBar(4, 4), 4);
  assert.equal(quartersPerBar(3, 4), 3);
  assert.equal(quartersPerBar(6, 8), 3);
  assert.equal(barsToBeats(2, 4, 4), 8);
  assert.equal(barsToBeats(1, 3, 4), 3);
});

test('breathPackets emit value, phase, cycle, and latched gates', () => {
  const packets = breathPackets({
    value: 0.5,
    phase: 0.25,
    cycle: 3,
    inhale: 1,
    exhale: 0,
    hold: 0,
  });
  assert.deepEqual(packets.map((p) => p.address), [
    BREATH_OSC_ADDRESSES.VALUE,
    BREATH_OSC_ADDRESSES.PHASE,
    BREATH_OSC_ADDRESSES.CYCLE,
    BREATH_OSC_ADDRESSES.INHALE,
    BREATH_OSC_ADDRESSES.EXHALE,
    BREATH_OSC_ADDRESSES.HOLD,
  ]);
  assert.equal(packets.every((p) => p.address !== '/ableview/breath'), true);
  assert.equal(packets[0].args[0].type, 'f');
  assert.equal(packets[2].args[0].type, 'i');
  assert.equal(packets[2].args[0].value, 3);
  assert.equal(packets[3].args[0].value, 1);
});

test('toOscBundle wraps breath packets in one immediate bundle', () => {
  const packets = breathPackets({
    value: 0.5,
    phase: 0.25,
    cycle: 3,
    inhale: 1,
    exhale: 0,
    hold: 0,
  });
  const bundle = toOscBundle(packets);
  assert.equal(bundle.packets.length, packets.length);
  assert.ok(bundle.timeTag);
  assert.deepEqual(bundle.packets.map((p) => p.address), packets.map((p) => p.address));
});

test('breathPacketDiff skips unchanged integers and tiny float noise', () => {
  const first = breathPacketDiff({
    value: 0.5, phase: 0.25, cycle: 3, inhale: 1, exhale: 0, hold: 0,
  });
  assert.ok(first.packets.some((p) => p.address === BREATH_OSC_ADDRESSES.VALUE));
  assert.equal(first.packets.some((p) => p.address === '/ableview/breath'), false);
  assert.equal(first.packets.filter((p) => p.address === BREATH_OSC_ADDRESSES.CYCLE).length, 1);

  const same = breathPacketDiff({
    value: 0.5 + 1e-6, phase: 0.25, cycle: 3, inhale: 1, exhale: 0, hold: 0,
  }, first.sent);
  assert.deepEqual(same.packets, []);

  const gate = breathPacketDiff({
    value: 0.5, phase: 0.25, cycle: 3, inhale: 0, exhale: 1, hold: 0,
  }, first.sent);
  assert.deepEqual(gate.packets.map((p) => p.address), [
    BREATH_OSC_ADDRESSES.INHALE,
    BREATH_OSC_ADDRESSES.EXHALE,
  ]);
});

test('breathRateMs maps 30 and 60 Hz', () => {
  assert.equal(breathRateMs({ rateHz: 30 }), 1000 / 30);
  assert.equal(breathRateMs({ rateHz: 60 }), 1000 / 60);
});

test('validateConfig rejects invalid breath knobs', () => {
  const cfg = structuredClone(DEFAULTS);
  cfg.ingest.authoritative.track = 'Cue';
  cfg.oscOut.breath = { ...DEFAULTS.oscOut.breath, rateHz: 120 };
  assert.throws(() => validateConfig(cfg), /rateHz/);
  cfg.oscOut.breath = { ...DEFAULTS.oscOut.breath, riseCurve: 'sine' };
  assert.throws(() => validateConfig(cfg), /riseCurve/);
  cfg.oscOut.breath = { ...DEFAULTS.oscOut.breath, risePower: 12 };
  assert.throws(() => validateConfig(cfg), /risePower/);
  cfg.oscOut.breath = { ...DEFAULTS.oscOut.breath, fallPower: 0 };
  assert.throws(() => validateConfig(cfg), /fallPower/);
  cfg.oscOut.breath = { ...DEFAULTS.oscOut.breath, riseStraight: 1.5 };
  assert.throws(() => validateConfig(cfg), /riseStraight/);
});

test('createOscOutput sends breath on the shared destinations when enabled', async () => {
  const bus = createBus();
  const sent = [];
  let now = 0;
  const intervals = [];
  const config = {
    oscOut: {
      enabled: true,
      destinations: [{ host: '192.168.1.10', port: 9000 }],
      breath: shape({ enabled: true, cycleBeats: 4 }),
    },
    ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
  };
  const out = createOscOutput({
    getConfig: () => config,
    bus,
    log: silentLog,
    sendPacket: (packet) => sent.push(packet),
    now: () => now,
    setIntervalFn: (fn, ms) => {
      intervals.push({ fn, ms });
      return 1;
    },
    clearIntervalFn: () => {},
  });
  await out.start();

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 120,
    beat: 0,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  }));

  assert.ok(sent.some((p) => p.address.startsWith('/ableview/clock/')));
  const before = sent.filter((p) => p.address.startsWith('/ableview/breath/')).length;
  assert.ok(before >= 6);
  assert.ok(sent.some((p) => p.address === BREATH_OSC_ADDRESSES.VALUE));
  assert.ok(sent.every((p) => p.host === '192.168.1.10' && p.port === 9000));

  now = 500;
  intervals[0].fn();
  const values = sent.filter((p) => p.address === BREATH_OSC_ADDRESSES.VALUE).map((p) => p.args[0].value);
  assert.ok(values.length >= 2);

  config.oscOut.breath.enabled = false;
  await out.start();
  const afterDisable = sent.length;
  if (intervals[0]) intervals[0].fn();
  assert.equal(sent.length, afterDisable);

  out.stop();
});

test('createOscOutput does not send breath when breath is disabled', async () => {
  const bus = createBus();
  const sent = [];
  const config = {
    oscOut: {
      enabled: true,
      destinations: [{ host: '192.168.1.10', port: 9000 }],
      breath: { enabled: false },
    },
    ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
  };
  const out = createOscOutput({
    getConfig: () => config,
    bus,
    log: silentLog,
    sendPacket: (packet) => sent.push(packet),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  await out.start();
  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 100,
    beat: 0,
    isPlaying: true,
  }));
  assert.ok(sent.every((p) => p.address.startsWith('/ableview/clock/')));
  out.stop();
});

test('breath page wires Start inhale now to the shared offset helper', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../public/shared/breath-render.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /phaseOffsetForInhaleAt/);
  assert.match(src, /Start inhale now/);
  assert.match(src, /inhaleNow\.disabled = songBeat == null/);
  assert.match(src, /Rise tightness/);
  assert.match(src, /Fall tightness/);
  assert.match(src, /risePower/);
  assert.match(src, /fallPower/);
  assert.match(src, /Rise straight mid/);
  assert.match(src, /Fall straight mid/);
  assert.match(src, /activeElement !== pair\.num/);
});
