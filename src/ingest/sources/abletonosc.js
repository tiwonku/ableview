import osc from 'osc';
import { EVENTS } from '../../core/bus.js';
import { makeNowPlaying, SOURCES } from '../../core/now-playing.js';
import { assertReadOnlyAddress } from '../osc-addresses.js';

const NOTHING_PLAYING = -1; // AbletonOSC: -1 = stopped, -2 = no clip slots

// Read-only AbletonOSC listener (spec §6). Registers listeners for the
// playing slot on each watched track, resolves clip names on change, and
// emits NowPlaying events. All outbound messages pass through send(), which
// enforces the NFR-1 read-only allowlist.
export function createAbletonOscSource({ config, bus, log }) {
  const { oscListenPort, oscSendPort, abletonHost, watchedTracks, authoritative } = config.ingest;

  let udp = null;
  let lastInboundAt = 0;
  let silenceTimer = null;

  // trackIndex -> { trackName, slotIndex, clipName }
  const trackState = new Map();
  let tempo = null;
  let beat = null;
  let lastEmittedKey = null;

  function send(address, args = []) {
    assertReadOnlyAddress(address);
    udp.send({ address, args }, abletonHost, oscSendPort);
  }

  function isWatched(trackName, trackIndex) {
    if (watchedTracks.length === 0) return true;
    return watchedTracks.some((t) => t === trackName || t === trackIndex);
  }

  function authoritativeClipOf() {
    if (authoritative.strategy === 'track') {
      for (const [index, state] of trackState) {
        if (state.trackName === authoritative.track || index === authoritative.track) {
          return state.clipName ?? null;
        }
      }
      return null;
    }
    // 'scene' and 'mostRecent' strategies are config-selectable but not
    // implemented in v2026 M1; fall back to "any playing watched clip".
    for (const state of trackState.values()) {
      if (state.clipName) return state.clipName;
    }
    return null;
  }

  function emitNowPlaying() {
    const tracks = [...trackState.entries()]
      .filter(([, s]) => s.clipName != null)
      .map(([trackIndex, s]) => ({
        trackIndex,
        trackName: s.trackName,
        clipName: s.clipName,
        slotIndex: s.slotIndex,
      }));

    const event = makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      tracks,
      authoritativeClip: authoritativeClipOf(),
      tempo,
      beat,
    });

    // Registration replies and explicit state queries can both report the
    // same state; only emit when the playing clips actually changed.
    const key = JSON.stringify([event.authoritativeClip, tracks]);
    if (key === lastEmittedKey) return;
    lastEmittedKey = key;

    log.info({ authoritativeClip: event.authoritativeClip, tracks: tracks.length }, 'now playing');
    bus.emit(EVENTS.NOW_PLAYING, event);
  }

  function registerListeners() {
    log.info({ host: abletonHost, sendPort: oscSendPort, listenPort: oscListenPort }, 'registering AbletonOSC listeners');
    send('/live/song/get/track_names');
    send('/live/song/get/tempo');
    send('/live/song/start_listen/tempo');
    send('/live/song/start_listen/beat');
    // Per-track listeners are registered once track names arrive.
  }

  function onTrackNames(args) {
    args.forEach((name, index) => {
      if (!isWatched(name, index)) return;
      if (!trackState.has(index)) {
        trackState.set(index, { trackName: name, slotIndex: null, clipName: null });
      } else {
        trackState.get(index).trackName = name;
      }
      send('/live/track/start_listen/playing_slot_index', [index]);
      send('/live/track/get/playing_slot_index', [index]);
    });
    log.info({ watched: [...trackState.keys()] }, 'watching tracks');
  }

  function onPlayingSlotIndex(args) {
    const [trackIndex, slotIndex] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.slotIndex = slotIndex;
    if (slotIndex == null || slotIndex <= NOTHING_PLAYING) {
      state.clipName = null;
      emitNowPlaying();
    } else {
      send('/live/clip/get/name', [trackIndex, slotIndex]);
    }
  }

  function onClipName(args) {
    const [trackIndex, , clipName] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.clipName = clipName;
    emitNowPlaying();
  }

  function onMessage(msg) {
    lastInboundAt = Date.now();
    switch (msg.address) {
      case '/live/song/get/track_names': return onTrackNames(msg.args);
      case '/live/track/get/playing_slot_index': return onPlayingSlotIndex(msg.args);
      case '/live/clip/get/name': return onClipName(msg.args);
      case '/live/song/get/tempo':
        tempo = msg.args[0];
        return;
      case '/live/song/get/beat':
        beat = msg.args[0];
        return;
      default:
        log.debug({ address: msg.address }, 'unhandled OSC message');
    }
  }

  // NFR-2: if Ableton restarts, listener registrations are lost silently.
  // Re-register whenever we have heard nothing for a while.
  function startSilenceWatchdog() {
    const silenceMs = 30_000;
    silenceTimer = setInterval(() => {
      if (Date.now() - lastInboundAt > silenceMs) {
        log.warn({ silenceMs }, 'no OSC traffic; re-registering listeners');
        registerListeners();
      }
    }, silenceMs);
    silenceTimer.unref?.();
  }

  function start() {
    return new Promise((resolvePromise, reject) => {
      udp = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: oscListenPort,
        metadata: false,
      });
      udp.on('ready', () => {
        registerListeners();
        startSilenceWatchdog();
        resolvePromise();
      });
      udp.on('message', onMessage);
      udp.on('error', (err) => {
        log.error({ err: err.message }, 'OSC error');
        if (!udp) reject(err);
      });
      udp.open();
    });
  }

  function stop() {
    if (silenceTimer) clearInterval(silenceTimer);
    if (udp) {
      try {
        send('/live/song/stop_listen/tempo');
        send('/live/song/stop_listen/beat');
        for (const index of trackState.keys()) {
          send('/live/track/stop_listen/playing_slot_index', [index]);
        }
      } catch { /* best effort on shutdown */ }
      udp.close();
      udp = null;
    }
  }

  return { name: SOURCES.ABLETONOSC, start, stop };
}
