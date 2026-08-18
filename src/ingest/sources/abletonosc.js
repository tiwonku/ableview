import osc from 'osc';
import { EVENTS } from '../../core/bus.js';
import { makeNowPlaying, SOURCES } from '../../core/now-playing.js';
import { assertReadOnlyAddress } from '../osc-addresses.js';
import { isValidSlot, isPendingLaunch, resolveAuthoritativeClipWithLatch } from '../authoritative-clip.js';
import {
  isArrangementPlaying,
  zipArrangementClips,
  applyArrangementClipName,
} from '../arrangement-clip.js';
import { makeIngestStatus } from '../ableton-session.js';
import {
  classifySlotChanges,
  mergeSceneInfo,
  sceneFromNowPlayingTracks,
  snapshotTrackSlots,
} from '../scene-launch.js';

// Read-only AbletonOSC listener (spec §6). Registers listeners for playing
// and fired slots on each watched track, resolves clip names on change, and
// emits NowPlaying events. Fired slots switch the authoritative clip before
// quantization so operator views anticipate scene launches. When a track
// reports playing_slot_index = -2, resolve the Arrangement clip under the
// playhead from arrangement_clips + song time.
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
  //   firedClipName, latchedClipName?, latchedSlotIndex?, arrangementClipName?,
  //   arrangementNames?, arrangementStartTimes?, arrangementLengths?, arrangementClips? }
  const trackState = new Map();
  let tempo = null;
  let beat = null;
  /** beats; from /live/song/get/current_song_time, else integer beat */
  let songTime = null;
  let signatureNumerator = null;
  let signatureDenominator = null;
  /** @type {boolean|null} null until Ableton replies to is_playing */
  let isPlaying = null;
  let lastEmittedKey = null;
  let selectedSceneIndex = null;
  /** sceneIndex -> name */
  const sceneNames = new Map();
  /** sceneIndex recently reported triggered via OSC */
  let sceneTriggeredIndex = null;
  let sceneTriggeredTimer = null;
  let prevTrackSnapshots = [];
  let pendingLaunchScene = null;
  let launchDebounceTimer = null;
  /** @type {ReturnType<typeof classifySlotChanges> | null} */
  let latchedLaunchScene = null;
  let launchId = 0;

  function send(address, args = []) {
    if (!udp) return;
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
    // bestMatch / scene / mostRecent: ingest hint is first fired-or-playing
    // watched clip. Matcher picks the sheet winner from tracks[].
    for (const state of trackState.values()) {
      const clip = resolveAuthoritativeClipWithLatch(state);
      if (clip) return clip;
    }
    return null;
  }

  function pendingLaunchOf() {
    const { authoritative } = getIngest();
    if (authoritative.strategy === 'track') {
      const state = authoritativeTrackState();
      if (!state) return false;
      return isPendingLaunch(state.playingSlotIndex, state.firedSlotIndex);
    }
    for (const state of trackState.values()) {
      if (isPendingLaunch(state.playingSlotIndex, state.firedSlotIndex)) return true;
    }
    return false;
  }

  function requestSceneName(sceneIndex) {
    if (!isValidSlot(sceneIndex)) return;
    if (sceneNames.has(sceneIndex)) return;
    send('/live/scene/get/name', [sceneIndex]);
  }

  function requestSceneTriggered(sceneIndex) {
    if (!isValidSlot(sceneIndex)) return;
    send('/live/scene/get/is_triggered', [sceneIndex]);
  }

  function markSceneTriggered(sceneIndex) {
    sceneTriggeredIndex = sceneIndex;
    if (sceneTriggeredTimer) clearTimeout(sceneTriggeredTimer);
    sceneTriggeredTimer = setTimeout(() => {
      sceneTriggeredIndex = null;
    }, 500);
    sceneTriggeredTimer.unref?.();
  }

  function flushLaunchClassification() {
    launchDebounceTimer = null;
    const snapshots = snapshotTrackSlots([...trackState.entries()]);
    const launch = classifySlotChanges(prevTrackSnapshots, snapshots, {
      sceneTriggeredIndex,
      selectedSceneIndex,
    });
    prevTrackSnapshots = snapshots;
    if (launch) {
      launchId += 1;
      latchedLaunchScene = { ...launch, launchId };
      pendingLaunchScene = latchedLaunchScene;
      if (launch.index != null) requestSceneName(launch.index);
    }
    emitNowPlaying();
  }

  function scheduleLaunchClassification() {
    if (launchDebounceTimer) clearTimeout(launchDebounceTimer);
    launchDebounceTimer = setTimeout(flushLaunchClassification, 80);
    launchDebounceTimer.unref?.();
  }

  function noteSlotActivity(trackIndex) {
    const state = trackState.get(trackIndex);
    if (!state) return;
    if (isPendingLaunch(state.playingSlotIndex, state.firedSlotIndex)) {
      requestSceneTriggered(state.firedSlotIndex);
    }
    scheduleLaunchClassification();
  }

  function songTimeOf() {
    if (songTime != null && Number.isFinite(Number(songTime))) return Number(songTime);
    if (beat != null && Number.isFinite(Number(beat))) return Number(beat);
    return null;
  }

  function anyArrangementPlaying() {
    for (const state of trackState.values()) {
      if (isArrangementPlaying(state.playingSlotIndex)) return true;
    }
    return false;
  }

  function requestSongTime() {
    send('/live/song/get/current_song_time');
  }

  function requestArrangementClips(trackIndex) {
    send('/live/track/get/arrangement_clips/name', [trackIndex]);
    send('/live/track/get/arrangement_clips/start_time', [trackIndex]);
    send('/live/track/get/arrangement_clips/length', [trackIndex]);
  }

  function refreshArrangementSources() {
    if (!anyArrangementPlaying()) return;
    requestSongTime();
    for (const [index, state] of trackState) {
      if (isArrangementPlaying(state.playingSlotIndex)) {
        requestArrangementClips(index);
      }
    }
  }

  function rebuildArrangementClips(state) {
    if (!state.arrangementNames || !state.arrangementStartTimes || !state.arrangementLengths) {
      return false;
    }
    state.arrangementClips = zipArrangementClips(
      state.arrangementNames,
      state.arrangementStartTimes,
      state.arrangementLengths
    );
    return applyArrangementClipName(state, songTimeOf());
  }

  function resolveArrangementTracks() {
    let changed = false;
    for (const state of trackState.values()) {
      if (applyArrangementClipName(state, songTimeOf())) changed = true;
    }
    return changed;
  }

  function emitNowPlaying() {
    // All watched tracks (including stopped) so Session / ops can see the full
    // candidate set. Prefer fired-or-playing (latched) so bestMatch can
    // anticipate launches the same way the cue-track strategy did.
    const tracks = [...trackState.entries()]
      .sort(([a], [b]) => a - b)
      .map(([trackIndex, s]) => {
        const clipName = resolveAuthoritativeClipWithLatch(s);
        const pending = isPendingLaunch(s.playingSlotIndex, s.firedSlotIndex);
        const arrangement = isArrangementPlaying(s.playingSlotIndex);
        const slotIndex = pending && isValidSlot(s.firedSlotIndex)
          ? s.firedSlotIndex
          : (isValidSlot(s.playingSlotIndex) ? s.playingSlotIndex : null);
        return {
          trackIndex,
          trackName: s.trackName,
          clipName: clipName ?? null,
          slotIndex,
          source: arrangement ? 'arrangement' : 'session',
        };
      });

    const pendingLaunch = pendingLaunchOf();
    const displayScene = sceneFromNowPlayingTracks(tracks, { pendingLaunch });
    const launchScene = pendingLaunch
      ? (pendingLaunchScene ?? latchedLaunchScene)
      : latchedLaunchScene;
    if (!pendingLaunch) pendingLaunchScene = null;

    const sceneIndex = launchScene?.index ?? displayScene.index ?? selectedSceneIndex;
    const sceneName = sceneIndex != null ? (sceneNames.get(sceneIndex) ?? null) : null;
    if (sceneIndex != null) requestSceneName(sceneIndex);

    const scene = mergeSceneInfo(displayScene, launchScene, sceneName);
    if (scene.launchId == null && latchedLaunchScene?.launchId != null) {
      scene.launchId = latchedLaunchScene.launchId;
    }

    const event = makeNowPlaying({
      source: SOURCES.ABLETONOSC,
      tracks,
      authoritativeClip: authoritativeClipOf(),
      tempo,
      beat,
      isPlaying,
      pendingLaunch,
      scene,
      signatureNumerator,
      signatureDenominator,
    });

    // Registration replies and explicit state queries can both report the
    // same state; only emit when clip, tempo, beat, play state, or launch changed.
    const key = JSON.stringify([
      event.authoritativeClip,
      event.pendingLaunch,
      tracks,
      event.tempo,
      event.beat,
      event.isPlaying,
      event.signatureNumerator ?? null,
      event.signatureDenominator ?? null,
      scene,
    ]);
    if (key === lastEmittedKey) return;
    lastEmittedKey = key;

    log.info({ authoritativeClip: event.authoritativeClip, tracks: tracks.length, scene: scene.launchType, isPlaying }, 'now playing');
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
    if (!udp) return;
    registerListeners();
    for (const index of trackState.keys()) {
      send('/live/track/get/playing_slot_index', [index]);
      send('/live/track/get/fired_slot_index', [index]);
    }
    refreshArrangementSources();
  }

  function registerListeners() {
    const { abletonHost, oscSendPort } = getIngest();
    log.info({ host: abletonHost, sendPort: oscSendPort, listenPort: oscListenPort }, 'registering AbletonOSC listeners');
    send('/live/song/get/track_names');
    send('/live/song/get/tempo');
    send('/live/song/get/is_playing');
    send('/live/song/get/signature_numerator');
    send('/live/song/get/signature_denominator');
    send('/live/song/start_listen/tempo');
    send('/live/song/start_listen/is_playing');
    send('/live/song/start_listen/beat');
    send('/live/song/start_listen/signature_numerator');
    send('/live/song/start_listen/signature_denominator');
    send('/live/view/start_listen/selected_scene');
    send('/live/view/get/selected_scene');
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
          arrangementClipName: null,
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
    prevTrackSnapshots = snapshotTrackSlots([...trackState.entries()]);
  }

  function onSelectedScene(args) {
    const [sceneIndex] = args;
    selectedSceneIndex = sceneIndex;
    if (isValidSlot(sceneIndex)) requestSceneName(sceneIndex);
    emitNowPlaying();
  }

  function onSceneName(args) {
    const [sceneIndex, name] = args;
    sceneNames.set(sceneIndex, String(name));
    emitNowPlaying();
  }

  function onSceneTriggered(args) {
    const [sceneIndex, triggered] = args;
    if (triggered === 1 || triggered === true) {
      markSceneTriggered(sceneIndex);
      if (
        latchedLaunchScene?.launchType === 'clip'
        && latchedLaunchScene.index === sceneIndex
      ) {
        latchedLaunchScene = {
          ...latchedLaunchScene,
          launchType: 'scene',
          trackIndex: null,
          trackName: null,
        };
        pendingLaunchScene = latchedLaunchScene;
      }
      scheduleLaunchClassification();
    }
  }

  function onPlayingSlotIndex(args) {
    const [trackIndex, slotIndex] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.playingSlotIndex = slotIndex;
    noteSlotActivity(trackIndex);
    if (isArrangementPlaying(slotIndex)) {
      state.playingClipName = null;
      requestArrangementClips(trackIndex);
      requestSongTime();
      applyArrangementClipName(state, songTimeOf());
      emitNowPlaying();
    } else if (!isValidSlot(slotIndex)) {
      state.playingClipName = null;
      applyArrangementClipName(state, songTimeOf());
      emitNowPlaying();
    } else {
      send('/live/clip/get/name', [trackIndex, slotIndex]);
    }
  }

  function onArrangementClipNames(args) {
    const [trackIndex, ...names] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.arrangementNames = names;
    rebuildArrangementClips(state);
    emitNowPlaying();
  }

  function onArrangementClipStartTimes(args) {
    const [trackIndex, ...times] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.arrangementStartTimes = times;
    rebuildArrangementClips(state);
    emitNowPlaying();
  }

  function onArrangementClipLengths(args) {
    const [trackIndex, ...lengths] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.arrangementLengths = lengths;
    rebuildArrangementClips(state);
    emitNowPlaying();
  }

  function onCurrentSongTime(args) {
    const t = args[0];
    if (t == null || !Number.isFinite(Number(t))) return;
    songTime = Number(t);
    resolveArrangementTracks();
    emitNowPlaying();
  }

  function onFiredSlotIndex(args) {
    const [trackIndex, slotIndex] = args;
    const state = trackState.get(trackIndex);
    if (!state) return;
    state.firedSlotIndex = slotIndex;
    noteSlotActivity(trackIndex);
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
      case '/live/track/get/arrangement_clips/name': return onArrangementClipNames(msg.args);
      case '/live/track/get/arrangement_clips/start_time': return onArrangementClipStartTimes(msg.args);
      case '/live/track/get/arrangement_clips/length': return onArrangementClipLengths(msg.args);
      case '/live/song/get/current_song_time': return onCurrentSongTime(msg.args);
      case '/live/view/get/selected_scene': return onSelectedScene(msg.args);
      case '/live/scene/get/name': return onSceneName(msg.args);
      case '/live/scene/get/is_triggered': return onSceneTriggered(msg.args);
      case '/live/song/get/tempo':
        tempo = msg.args[0];
        return emitNowPlaying();
      case '/live/song/get/is_playing':
        isPlaying = msg.args[0] === 1 || msg.args[0] === true;
        if (anyArrangementPlaying()) requestSongTime();
        return emitNowPlaying();
      case '/live/song/get/beat':
        beat = msg.args[0];
        if (songTime == null || Math.floor(Number(songTime)) < Number(beat)) {
          songTime = beat;
        }
        if (anyArrangementPlaying()) resolveArrangementTracks();
        return emitNowPlaying();
      case '/live/song/get/signature_numerator':
        signatureNumerator = msg.args[0];
        return emitNowPlaying();
      case '/live/song/get/signature_denominator':
        signatureDenominator = msg.args[0];
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
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (launchDebounceTimer) {
      clearTimeout(launchDebounceTimer);
      launchDebounceTimer = null;
    }
    if (sceneTriggeredTimer) {
      clearTimeout(sceneTriggeredTimer);
      sceneTriggeredTimer = null;
    }
    if (udp) {
      try {
        send('/live/song/stop_listen/tempo');
        send('/live/song/stop_listen/is_playing');
        send('/live/song/stop_listen/beat');
        send('/live/song/stop_listen/signature_numerator');
        send('/live/song/stop_listen/signature_denominator');
        send('/live/view/stop_listen/selected_scene');
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
