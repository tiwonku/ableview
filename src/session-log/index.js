import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { EVENTS } from '../core/bus.js';
import { SOURCES } from '../core/now-playing.js';
import { sanitizeSessionName, sessionFilePath } from './sanitize.js';
import { resolveLogTimestamp } from './timestamp.js';
import { clipKey, diffTracks, matchKey, trackStateKey } from './tracks.js';
import { buildLaunchRecord, emptyLaunchSummary, incrementLaunchSummary, launchLogKey } from './launch.js';

const SIDECAR_NAME = '.active.json';

function readSidecar(sidecarPath) {
  try {
    if (!existsSync(sidecarPath)) return null;
    return JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeSidecar(sidecarPath, data) {
  mkdirSync(dirname(sidecarPath), { recursive: true });
  writeFileSync(sidecarPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function countLinesInFile(filePath) {
  try {
    if (!existsSync(filePath)) return 0;
    const content = readFileSync(filePath, 'utf8');
    if (!content) return 0;
    return content.split('\n').filter((line) => line.trim()).length;
  } catch {
    return 0;
  }
}

export function createSessionLogger({
  bus,
  getConfig,
  getTimecodeStatus,
  getSimulated,
  log,
  cwd = process.cwd(),
}) {
  let enabled = false;
  let sessionName = null;
  let lineCount = 0;
  let startedAt = null;
  let lastLoggedAt = null;
  let filePath = null;
  let absolutePath = null;

  let lastTrackState = null;
  let lastClipKey = null;
  let lastMatchKey = null;
  let lastLaunchKey = null;
  let launchSummary = emptyLaunchSummary();

  let onNowPlaying = null;
  let onCuePayload = null;

  function sessionConfig() {
    return getConfig().sessionLog ?? {};
  }

  function sidecarPath() {
    const { dir } = sessionFilePath(sessionConfig().directory ?? './data/sessions', 'x', cwd);
    return resolve(dir, SIDECAR_NAME);
  }

  function resetDedupeState() {
    lastTrackState = null;
    lastClipKey = null;
    lastMatchKey = null;
    lastLaunchKey = null;
    launchSummary = emptyLaunchSummary();
  }

  function persistSidecar() {
    writeSidecar(sidecarPath(), {
      enabled,
      sessionName,
      fileName: sessionName ? `${sessionName}.jsonl` : null,
      startedAt,
      lineCount,
      lastLoggedAt,
      launchSummary,
    });
  }

  function closeStream() {
    // appendFileSync — no open stream handle
  }

  function openStream(name) {
    const cfg = sessionConfig();
    const { dir, file, relative } = sessionFilePath(cfg.directory ?? './data/sessions', name, cwd);
    mkdirSync(dir, { recursive: true });
    const existed = existsSync(file);
    sessionName = name;
    filePath = relative;
    absolutePath = file;
    if (!existed) {
      lineCount = 0;
      startedAt = new Date().toISOString();
    } else {
      lineCount = countLinesInFile(file);
      startedAt = startedAt ?? new Date().toISOString();
    }
  }

  function timestampEnvelope() {
    const ts = resolveLogTimestamp(getTimecodeStatus);
    const loggedAt = new Date().toISOString();
    lastLoggedAt = loggedAt;
    return { ...ts, loggedAt };
  }

  function appendRecord(record) {
    if (!enabled || !absolutePath) return;
    try {
      appendFileSync(absolutePath, `${JSON.stringify(record)}\n`, 'utf8');
      lineCount += 1;
      persistSidecar();
    } catch (err) {
      log.error({ err: err.message, file: absolutePath }, 'session log write error');
    }
  }

  function isSimulatedFromEvent(event) {
    if (typeof getSimulated === 'function') return getSimulated() === true;
    return event?.source === SOURCES.SIMULATOR;
  }

  function handleNowPlaying(event) {
    if (!enabled) return;

    const scene = event.scene ?? null;
    const launchKey = launchLogKey(scene);
    if (launchKey && launchKey !== lastLaunchKey) {
      lastLaunchKey = launchKey;
      const envelope = timestampEnvelope();
      appendRecord(buildLaunchRecord(scene, envelope, {
        authoritativeClip: event.authoritativeClip ?? null,
        tempo: event.tempo ?? null,
        beat: event.beat ?? null,
        simulated: isSimulatedFromEvent(event),
        sessionName,
      }));
      launchSummary = incrementLaunchSummary(launchSummary, scene.launchType);
    }

    const nextKey = trackStateKey(event.tracks);
    if (nextKey === lastTrackState) return;

    const changed = diffTracks(lastTrackState, event.tracks);
    lastTrackState = nextKey;

    if (changed.length === 0) return;

    const simulated = isSimulatedFromEvent(event);
    const envelope = timestampEnvelope();

    for (const track of changed) {
      appendRecord({
        ...envelope,
        event: 'track_clip',
        trackIndex: track.trackIndex,
        trackName: track.trackName,
        clipName: track.clipName,
        slotIndex: track.slotIndex,
        authoritativeClip: event.authoritativeClip ?? null,
        tempo: event.tempo ?? null,
        beat: event.beat ?? null,
        pendingLaunch: event.pendingLaunch ?? false,
        simulated,
        sessionName,
      });
    }
  }

  function handleCuePayload(payload) {
    const ck = clipKey(payload);
    const mk = matchKey(payload);

    if (enabled) {
      let reason = null;
      if (ck !== lastClipKey) {
        reason = 'clip_change';
      } else if (mk !== lastMatchKey) {
        reason = 'match_change';
      }

      if (reason) {
        const envelope = timestampEnvelope();
        const record = {
          ...envelope,
          event: 'match',
          clipName: payload.clipName ?? null,
          match: payload.match,
          reason,
          syncedAt: payload.syncedAt ?? null,
          stale: payload.stale === true,
          tempo: payload.tempo ?? null,
          beat: payload.beat ?? null,
          pendingLaunch: payload.pendingLaunch ?? false,
          simulated: !!payload.simulated,
          sessionName,
        };
        if (payload.row != null) record.row = payload.row;
        appendRecord(record);
      }
    }

    lastClipKey = ck;
    lastMatchKey = mk;
  }

  function disableLogging() {
    enabled = false;
    closeStream();
    resetDedupeState();
    persistSidecar();
  }

  function enableLogging(name) {
    const sanitized = sanitizeSessionName(name);
    const rotating = sessionName !== sanitized || !absolutePath;
    if (rotating) {
      openStream(sanitized);
    }
    if (rotating || !enabled) {
      resetDedupeState();
    }
    enabled = true;
    persistSidecar();
    log.info({ sessionName: sanitized, file: filePath }, 'session log enabled');
  }

  function getStatus() {
    const cfg = sessionConfig();
    return {
      enabled,
      sessionName,
      filePath: enabled ? filePath : null,
      absolutePath: enabled ? absolutePath : null,
      lineCount: enabled ? lineCount : 0,
      startedAt: enabled ? startedAt : null,
      lastLoggedAt: enabled ? lastLoggedAt : null,
      launchSummary: enabled ? { ...launchSummary } : emptyLaunchSummary(),
      config: {
        directory: cfg.directory ?? './data/sessions',
        autoStart: cfg.autoStart === true,
        autoStartWhenSim: cfg.autoStartWhenSim !== false,
        defaultSessionName: cfg.defaultSessionName ?? 'test',
      },
    };
  }

  function applyPatch({ enabled: nextEnabled, sessionName: nextName } = {}) {
    if (nextEnabled === false) {
      if (nextName !== undefined) {
        sessionName = sanitizeSessionName(nextName);
      }
      disableLogging();
      return getStatus();
    }

    const shouldEnable = nextEnabled === true || (nextName !== undefined && nextEnabled === undefined);
    if (shouldEnable) {
      const name = nextName !== undefined
        ? sanitizeSessionName(nextName)
        : (sessionName ?? sanitizeSessionName(sessionConfig().defaultSessionName ?? 'test'));
      enableLogging(name);
      return getStatus();
    }

    if (nextName !== undefined) {
      sessionName = sanitizeSessionName(nextName);
      persistSidecar();
    }

    return getStatus();
  }

  function start() {
    const cfg = sessionConfig();
    mkdirSync(resolve(cwd, cfg.directory ?? './data/sessions'), { recursive: true });

    const sidecar = readSidecar(sidecarPath());
    if (sidecar?.enabled === true && sidecar.sessionName) {
      sessionName = sanitizeSessionName(sidecar.sessionName);
      openStream(sessionName);
      enabled = true;
      lineCount = sidecar.lineCount ?? lineCount;
      startedAt = sidecar.startedAt ?? startedAt;
      lastLoggedAt = sidecar.lastLoggedAt ?? null;
      launchSummary = sidecar.launchSummary ?? emptyLaunchSummary();
      log.info({ sessionName, restored: true }, 'session log restored from sidecar');
    } else if (cfg.autoStart === true) {
      enableLogging(cfg.defaultSessionName ?? 'test');
    } else if (cfg.autoStartWhenSim !== false && getConfig().sim?.enabled === true) {
      enableLogging(cfg.defaultSessionName ?? 'test');
    } else {
      sessionName = sanitizeSessionName(cfg.defaultSessionName ?? 'test');
      persistSidecar();
    }

    onNowPlaying = (event) => handleNowPlaying(event);
    onCuePayload = (payload) => handleCuePayload(payload);
    bus.on(EVENTS.NOW_PLAYING, onNowPlaying);
    bus.on(EVENTS.CUE_PAYLOAD, onCuePayload);
  }

  function stop() {
    if (onNowPlaying) {
      bus.off(EVENTS.NOW_PLAYING, onNowPlaying);
      onNowPlaying = null;
    }
    if (onCuePayload) {
      bus.off(EVENTS.CUE_PAYLOAD, onCuePayload);
      onCuePayload = null;
    }
    disableLogging();
  }

  return {
    start,
    stop,
    getStatus,
    applyPatch,
    handleNowPlaying,
    handleCuePayload,
  };
}
