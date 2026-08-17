import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveTransportClock } from '../src/core/clock.js';
import { createBus, EVENTS } from '../src/core/bus.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { createLogger } from '../src/core/logger.js';
import {
  OSC_OUT_ADDRESSES,
  clockPackets,
  createOscOutput,
  isMulticastHost,
  resolveDestinations,
} from '../src/outputs/osc.js';

const silentLog = createLogger();
silentLog.level = 'silent';

test('liveTransportClock maps 4/4 song beats to Live 1-based bars.beats', () => {
  assert.deepEqual(liveTransportClock(0, 4, 4), {
    bar: 1, beat: 1, songBeat: 0, quartersPerBar: 4,
  });
  assert.deepEqual(liveTransportClock(3, 4, 4), {
    bar: 1, beat: 4, songBeat: 3, quartersPerBar: 4,
  });
  assert.deepEqual(liveTransportClock(4, 4, 4), {
    bar: 2, beat: 1, songBeat: 4, quartersPerBar: 4,
  });
});

test('liveTransportClock handles 3/4 and 6/8', () => {
  assert.equal(liveTransportClock(2, 3, 4).bar, 1);
  assert.equal(liveTransportClock(2, 3, 4).beat, 3);
  assert.equal(liveTransportClock(3, 3, 4).bar, 2);
  assert.equal(liveTransportClock(3, 3, 4).beat, 1);

  // 6/8 → 3 quarter notes per bar (AbletonOSC pulses on quarter notes)
  assert.equal(liveTransportClock(0, 6, 8).quartersPerBar, 3);
  assert.equal(liveTransportClock(2, 6, 8).bar, 1);
  assert.equal(liveTransportClock(2, 6, 8).beat, 3);
  assert.equal(liveTransportClock(3, 6, 8).bar, 2);
  assert.equal(liveTransportClock(3, 6, 8).beat, 1);
});

test('liveTransportClock returns nulls when song beat is missing', () => {
  assert.equal(liveTransportClock(null).bar, null);
  assert.equal(liveTransportClock(undefined).beat, null);
});

test('isMulticastHost detects 224–239.x only', () => {
  assert.equal(isMulticastHost('239.0.0.1'), true);
  assert.equal(isMulticastHost('224.0.0.1'), true);
  assert.equal(isMulticastHost('192.168.1.10'), false);
  assert.equal(isMulticastHost('240.0.0.1'), false);
  assert.equal(isMulticastHost('lighting.local'), false);
});

test('resolveDestinations skips Ableton ingest host:port', () => {
  const { destinations, skippedAbleton } = resolveDestinations(
    {
      destinations: [
        { host: '10.0.0.5', port: 11000 },
        { host: '192.168.1.40', port: 9000 },
      ],
    },
    { abletonHost: '10.0.0.5', oscSendPort: 11000 },
  );
  assert.deepEqual(destinations, [{ host: '192.168.1.40', port: 9000, multicast: false }]);
  assert.deepEqual(skippedAbleton, ['10.0.0.5:11000']);
});

test('clockPackets snapshot sends is_playing, tempo, signature, bar, then beat', () => {
  const { packets } = clockPackets({
    tempo: 128,
    beat: 4,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  }, null, { snapshot: true });

  assert.deepEqual(packets.map((p) => p.address), [
    OSC_OUT_ADDRESSES.IS_PLAYING,
    OSC_OUT_ADDRESSES.TEMPO,
    OSC_OUT_ADDRESSES.SIGNATURE,
    OSC_OUT_ADDRESSES.BAR,
    OSC_OUT_ADDRESSES.BEAT,
  ]);
  assert.equal(packets[0].args[0].value, 1);
  assert.equal(packets[1].args[0].type, 'f');
  assert.equal(packets[1].args[0].value, 128);
  assert.deepEqual(packets[2].args.map((a) => a.value), [4, 4]);
  assert.equal(packets[3].args[0].value, 2); // songBeat 4 → bar 2
  assert.equal(packets[4].args[0].value, 1); // beat-in-bar 1
});

test('clockPackets sends bar before beat on downbeat and beat-only otherwise', () => {
  const first = clockPackets({
    tempo: 120,
    beat: 0,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  });
  assert.deepEqual(
    first.packets.filter((p) => p.address === OSC_OUT_ADDRESSES.BAR || p.address === OSC_OUT_ADDRESSES.BEAT)
      .map((p) => [p.address, p.args[0].value]),
    [[OSC_OUT_ADDRESSES.BAR, 1], [OSC_OUT_ADDRESSES.BEAT, 1]],
  );

  const mid = clockPackets({
    tempo: 120,
    beat: 1,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  }, first.sent);
  assert.deepEqual(mid.packets.map((p) => p.address), [OSC_OUT_ADDRESSES.BEAT]);
  assert.equal(mid.packets[0].args[0].value, 2);

  const nextBar = clockPackets({
    tempo: 120,
    beat: 4,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  }, mid.sent);
  assert.deepEqual(
    nextBar.packets.map((p) => [p.address, p.args[0].value]),
    [[OSC_OUT_ADDRESSES.BAR, 2], [OSC_OUT_ADDRESSES.BEAT, 1]],
  );
});

test('clockPackets tempo-only change does not pulse beat', () => {
  const first = clockPackets({ tempo: 120, beat: 2, isPlaying: true });
  const next = clockPackets({ tempo: 128, beat: 2, isPlaying: true }, first.sent);
  assert.deepEqual(next.packets.map((p) => p.address), [OSC_OUT_ADDRESSES.TEMPO]);
});

test('createOscOutput fans out to every destination and skips Ableton', async () => {
  const bus = createBus();
  const sent = [];
  const config = {
    oscOut: {
      enabled: true,
      destinations: [
        { host: '192.168.1.10', port: 9000 },
        { host: '192.168.1.11', port: 9001 },
        { host: '10.0.0.5', port: 11000 },
      ],
    },
    ingest: { abletonHost: '10.0.0.5', oscSendPort: 11000 },
  };
  const out = createOscOutput({
    getConfig: () => config,
    bus,
    log: silentLog,
    sendPacket: (packet) => sent.push(packet),
  });
  await out.start();

  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 100,
    beat: 0,
    isPlaying: true,
    signatureNumerator: 4,
    signatureDenominator: 4,
  }));

  const hosts = [...new Set(sent.map((p) => `${p.host}:${p.port}`))].sort();
  assert.deepEqual(hosts, ['192.168.1.10:9000', '192.168.1.11:9001']);
  assert.ok(sent.some((p) => p.address === OSC_OUT_ADDRESSES.BEAT && p.args[0].value === 1));
  assert.ok(sent.some((p) => p.address === OSC_OUT_ADDRESSES.BAR && p.args[0].value === 1));
  assert.ok(sent.every((p) => p.address.startsWith('/ableview/clock/')));

  out.stop();
});

test('createOscOutput does not send when disabled', async () => {
  const bus = createBus();
  const sent = [];
  const config = {
    oscOut: { enabled: false, destinations: [{ host: '192.168.1.10', port: 9000 }] },
    ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
  };
  const out = createOscOutput({
    getConfig: () => config,
    bus,
    log: silentLog,
    sendPacket: (packet) => sent.push(packet),
  });
  await out.start();
  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.SIMULATOR,
    tempo: 120,
    beat: 0,
    isPlaying: true,
  }));
  assert.equal(sent.length, 0);
  out.stop();
});
