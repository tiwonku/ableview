import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import osc from 'osc';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { createAbletonOscSource } from '../src/ingest/sources/abletonosc.js';
import { DEFAULTS } from '../src/config/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

async function arrangementOscConfig() {
  const oscSendPort = await freeUdpPort();
  const oscListenPort = await freeUdpPort();
  return {
    ...DEFAULTS,
    ingest: {
      ...DEFAULTS.ingest,
      oscListenPort,
      oscSendPort,
      abletonHost: '127.0.0.1',
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
      staleAfterMs: 5000,
      pollIntervalMs: 2000,
    },
  };
}

/** Minimal AbletonOSC stand-in that plays one Arrangement clip on Cue. */
function createArrangementMock({ listenPort, replyPort }) {
  let udp = null;
  const TRACK_NAMES = ['Cue'];
  const playingSlotIndex = -2;
  const firedSlotIndex = -1;
  const clipName = 'Still Night';
  const startTime = 0;
  const length = 64;
  let songTime = 8;

  function reply(to, address, args = []) {
    udp.send({ address, args }, to.address, to.port);
  }

  function onMessage(msg, _timeTag, info) {
    const from = { address: info.address, port: replyPort };
    switch (msg.address) {
      case '/live/song/get/track_names':
        return reply(from, '/live/song/get/track_names', TRACK_NAMES);
      case '/live/song/get/tempo':
      case '/live/song/start_listen/tempo':
        return reply(from, '/live/song/get/tempo', [98]);
      case '/live/song/get/is_playing':
      case '/live/song/start_listen/is_playing':
        return reply(from, '/live/song/get/is_playing', [1]);
      case '/live/song/get/signature_numerator':
      case '/live/song/start_listen/signature_numerator':
        return reply(from, '/live/song/get/signature_numerator', [4]);
      case '/live/song/get/signature_denominator':
      case '/live/song/start_listen/signature_denominator':
        return reply(from, '/live/song/get/signature_denominator', [4]);
      case '/live/song/get/current_song_time':
        return reply(from, '/live/song/get/current_song_time', [songTime]);
      case '/live/view/get/selected_scene':
      case '/live/view/start_listen/selected_scene':
        return reply(from, '/live/view/get/selected_scene', [0]);
      case '/live/track/start_listen/playing_slot_index':
      case '/live/track/get/playing_slot_index':
        return reply(from, '/live/track/get/playing_slot_index', [msg.args[0], playingSlotIndex]);
      case '/live/track/start_listen/fired_slot_index':
      case '/live/track/get/fired_slot_index':
        return reply(from, '/live/track/get/fired_slot_index', [msg.args[0], firedSlotIndex]);
      case '/live/track/get/arrangement_clips/name':
        return reply(from, '/live/track/get/arrangement_clips/name', [msg.args[0], clipName]);
      case '/live/track/get/arrangement_clips/start_time':
        return reply(from, '/live/track/get/arrangement_clips/start_time', [msg.args[0], startTime]);
      case '/live/track/get/arrangement_clips/length':
        return reply(from, '/live/track/get/arrangement_clips/length', [msg.args[0], length]);
      default:
        return undefined;
    }
  }

  function start() {
    return new Promise((resolvePromise, reject) => {
      udp = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: listenPort,
        metadata: false,
      });
      udp.on('ready', () => resolvePromise());
      udp.on('message', onMessage);
      udp.on('error', (err) => reject(err));
      udp.open();
    });
  }

  function stop() {
    if (udp) {
      udp.close();
      udp = null;
    }
  }

  return { start, stop, setSongTime: (t) => { songTime = t; } };
}

test('arrangement playing_slot_index resolves clip under playhead', async () => {
  const bus = createBus();
  const events = [];
  bus.on(EVENTS.NOW_PLAYING, (e) => events.push(e));

  const config = await arrangementOscConfig();
  const mock = createArrangementMock({
    listenPort: config.ingest.oscSendPort,
    replyPort: config.ingest.oscListenPort,
  });
  const adapter = createAbletonOscSource({ config, bus, log: silentLog });

  await mock.start();
  await adapter.start();

  try {
    const deadline = Date.now() + 1500;
    let found = null;
    while (Date.now() < deadline) {
      found = events.find((e) => e.authoritativeClip === 'Still Night');
      if (found) break;
      await wait(40);
    }
    assert.ok(found, 'expected NowPlaying with Arrangement clip name');
    assert.equal(found.tracks[0]?.clipName, 'Still Night');
    assert.equal(found.tracks[0]?.source, 'arrangement');
    assert.equal(found.tracks[0]?.slotIndex, null);
    assert.equal(found.pendingLaunch, false);
  } finally {
    adapter.stop();
    mock.stop();
  }
});
