import osc from 'osc';
import { EVENTS } from '../../core/bus.js';
import { makeNowPlaying, SOURCES } from '../../core/now-playing.js';
import { assertReadOnlyAddress } from '../osc-addresses.js';
import { isValidSlot, isPendingLaunch, resolveAuthoritativeClipWithLatch } from '../authoritative-clip.js';
import { makeIngestStatus } from '../ableton-session.js';

// Read-only AbletonOSC listener (spec §6). Registers listeners for playing
// and fired slots on each watched track, resolves clip names on change, and
// emits NowPlaying events. Fired slots switch the authoritative clip before
// quantization so operator views anticipate scene launches.
export function createAbletonOscSource({ config, getIngestConfig, bus, log }) {
  const getIngest = getIngestConfig ?? (() => config.ingest);
  const { oscListenPort } = getIngest();

  let udp = null;
  let lastInboundAt = 0;
  let ingestLive = false;
  let pollTimer = null;
  /** @type {string[]|null} null until /live/song/get/track_names replies */
  let sessionTrackNames = null;

  // trackIndex -> { trackName, playingSlotIndex, playingClipName, firedSlotIndex,
  //   firedClipName, latchedClipName?, latchedSlotIndex? }
  const trackState = new Map();
  let tempo = null;
  let beat = null;
  let lastEmittedKey = null;

  function send(address, args = []) {
    assertReadOnlyAddress(address);
    const { abletonHost, oscSendPort } = getIngest();
    udp.send({ address, args }, abletonHost, oscSendPort);
  }

  function isWatched(trackName, trackIndex) {
    const { watchedTracks } = getIngest();
    if (watchedTracks.length === 0) return true;
    return watchedTracks.some((t) => t === trackName || t === trackIndex);
  }

  function authoritativeTrackState() {
    const { authoritative } = getIngest();
    if (authoritative.strategy === 'track') {
      for (const [index, state] of trackState) {
        if (state.trackName === authoritative.track || index === authoritative.track) {
          return state;
        }
      }
      return null;
    }
    return null;
  }

  function authoritativeClipOf() {
    const { authoritative } = getIngest();
    if (authoritative.strategy === 'track') {
      const state = authoritativeTrackState();
      return state ? resolveAuthoritativeClipWithLatch(state) : null;
    }
    // 'scene' and 'mostRecent' strategies are config-selectable but not
    // implemented in v2026 M1; fall back to fired-then-playing on watched tracks.
    for (const state of trackState.values()) {
      const clip = resolveAuthoritativeClipWithLatch(state);
      if (clip) return clip;
    }
    return null;
  }

  function pendingLaunchOf() {
    const state = authoritativeTrackState();
    if (!state) return false;
    return isPendingLaunch(state.playingSlotIndex, state.firedSlotIndex);
  }

  function emitNowPlaying() {
    const tracks = [...trackState.entries()]
      .filter(([, s]) => s.playingClipName != null)
      .map(([trackIndex, s]) => ({
        trackIndex,
        trackName: s.trackName,
        clipName: s.playingClipName,
        slotIndex: s.playingSlotIndex,
      }));

    const pendingLaunch = pendingLaunchOf();
    const event = makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      tracks,
      authoritativeClip: authoritativeClipOf(),
      tempo,
      beat,
      pendingLaunch,
    });

    // Registration replies and explicit state queries can both report the
    // same state; only emit when clip, tempo, beat, or launch state changed.
    const key = JSON.stringify([
      event.authoritativeClip,
      event.pendingLaunch,
      tracks,
      event.tempo,
      event.beat,
    ]);
    if (key === lastEmittedKey) return;
    lastEmittedKey = key;

    log.info({ authoritativeClip: event.authoritativeClip, tracks: tracks.length }, 'now playing');
    bus.emit(EVENTS.NOW_PLAYING, event);
  }

  function currentIngestStatus() {
    const { authoritative } = getIngest();
    return makeIngestStatus({
      live: ingestLive,
      lastSeenAt: lastInboundAt || null,
      trackNames: sessionTrackNames,
      authoritativeTrack: authoritative?.track,
    });
  }

  function emitIngestStatus() {
    bus.emit(EVENTS.INGEST_STATUS, currentIngestStatus());
  }

  function setIngestLive(live) {
    if (ingestLive === live) return;
    ingestLive = live;
    log.info({ live }, 'ingest status');
    emitIngestStatus();
  }

  function probeAbleton() {
    registerListeners();
    for (const index of trackState.keys()) {
      send('/live/track/get/playing_slot_index', [index]);
      send('/live/track/get/fired_slot_index', [index]);
    }
  }

  function registerListeners() {
    const { abletonHost, oscSendPort } = getIngest();
    log.info({ host: abletonHost, sendPort: oscSendPort, listenPort: oscListenPort }, 'registering AbletonOSC listeners');
    send('/live/song/get/track_names');
    send('/live/song/get/tempo');
    send('/live/song/start_listen/tempo');
    send('/live/song/start_listen/beat');
    // Per-track listeners are registered once track names arrive.
  }

  function onTrackNames(args) {
    const names = args.map((name) => String(name));
    const prevKey = JSON.stringify(sessionTrackNames);
    sessionTrackNames = names;

    names.forEach((name, index) => {
      if (!isWatched(name, index)) return;
      if (!trackState.has(index)) {
        trackState.set(index, {
          trackName: name,
          playingSlotIndex: null,
          playingClipName: null,
          firedSlotIndex: null,
          firedClipName: null,
        });
      } else {
        trackState.get(index).trackName = name;
      }
      send('/live/track/start_listen/playing_slot_index', [index]);
      send('/live/track/get/playing_slot_index', [index]);
      send('/live/track/start_listen/fired_slot_index', [index]);
      send('/live/track/get/fired_slot_index', [index]);
    });

    const status = currentIngestStatus();
    log.info(
      {
        tracks: names.length,
        watched: [...trackState.keys()],
        cueTrackConfigured: status.cueTrackConfigured,
        cueTrackFound: status.cueTrackFound,
      },
      'session track names'
    );
    if (JSON.stringify(sessionTrackNames) !== prevKey) {
      emitIngestStatus();
    }
  }

  function onPlayingSlotIndex(args) {
    const [trackIndex, slotIndex] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.playingSlotIndex = slotIndex;
    if (!isValidSlot(slotIndex)) {
      state.playingClipName = null;
      emitNowPlaying();
    } else {
      send('/live/clip/get/name', [trackIndex, slotIndex]);
    }
  }

  function onFiredSlotIndex(args) {
    const [trackIndex, slotIndex] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.firedSlotIndex = slotIndex;
    if (!isValidSlot(slotIndex)) {
      state.firedClipName = null;
      emitNowPlaying();
    } else {
      send('/live/clip/get/name', [trackIndex, slotIndex]);
    }
  }

  function onClipName(args) {
    const [trackIndex, slotIndex, clipName] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    if (state.playingSlotIndex === slotIndex) {
      state.playingClipName = clipName;
    }
    if (state.firedSlotIndex === slotIndex) {
      state.firedClipName = clipName;
    }
    emitNowPlaying();
  }

  function onMessage(msg) {
    lastInboundAt = Date.now();
    if (!ingestLive) {
      setIngestLive(true);
      probeAbleton();
    }
    switch (msg.address) {
      case '/live/song/get/track_names': return onTrackNames(msg.args);
      case '/live/track/get/playing_slot_index': return onPlayingSlotIndex(msg.args);
      case '/live/track/get/fired_slot_index': return onFiredSlotIndex(msg.args);
      case '/live/clip/get/name': return onClipName(msg.args);
      case '/live/song/get/tempo':
        tempo = msg.args[0];
        return emitNowPlaying();
      case '/live/song/get/beat':
        beat = msg.args[0];
        return emitNowPlaying();
      default:
        log.debug({ address: msg.address }, 'unhandled OSC message');
    }
  }

  // NFR-2: if Ableton restarts, listener registrations are lost silently.
  // Poll on a short interval, mark ingest stale when OSC goes quiet, and
  // probe aggressively while stale so clip changes are picked up quickly.
  function startLivenessWatch() {
    const { staleAfterMs, pollIntervalMs } = getIngest();
    pollTimer = setInterval(() => {
      const silentMs = lastInboundAt > 0 ? Date.now() - lastInboundAt : Infinity;

      if (ingestLive && silentMs > staleAfterMs) {
        setIngestLive(false);
      }

      if (!ingestLive || silentMs > pollIntervalMs / 2) {
        probeAbleton();
      }
    }, pollIntervalMs);
    pollTimer.unref?.();
  }

  function getIngestStatus() {
    return currentIngestStatus();
  }

  function start() {
    return new Promise((resolvePromise, reject) => {
      udp = new osc.UDPPort({
        localAddress: '0.0.0.0',
        localPort: oscListenPort,
        metadata: false,
      });
      udp.on('ready', () => {
        emitIngestStatus();
        registerListeners();
        startLivenessWatch();
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
    if (pollTimer) clearInterval(pollTimer);
    if (udp) {
      try {
        send('/live/song/stop_listen/tempo');
        send('/live/song/stop_listen/beat');
        for (const index of trackState.keys()) {
          send('/live/track/stop_listen/playing_slot_index', [index]);
          send('/live/track/stop_listen/fired_slot_index', [index]);
        }
      } catch { /* best effort on shutdown */ }
      udp.close();
      udp = null;
    }
  }

  return { name: SOURCES.ABLETONOSC, start, stop, getIngestStatus };
}
