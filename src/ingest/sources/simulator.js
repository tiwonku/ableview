import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENTS } from '../../core/bus.js';
import { makeNowPlaying, SOURCES } from '../../core/now-playing.js';
import { makeSceneInfo, sceneFromNowPlayingTracks } from '../scene-launch.js';

const SIM_TRACK = { trackIndex: 0, trackName: 'Cue', slotIndex: 0 };

// Simulation source (spec §7). Emits the exact same NowPlaying contract as
// the real listener so nothing downstream is special-cased.
//
// Drivers:
//   scenario       — ordered { clipName, holdSeconds } steps from a JSON file
//   manual         — fire clips on demand via .fire(clipName)
//   sheetClipNames — walk the loaded sheet's matchColumn values; requires a
//                    getClipNames provider (wired up with sheets sync in M2)
export function createSimulatorSource({ config, bus, log, getClipNames = null }) {
  const { driver, scenario, intervalSeconds } = config.sim;

  let timer = null;
  let stepIndex = 0;
  let paused = false;
  let scenarioLoop = false;

  function isAutoDriver() {
    return driver === 'scenario' || driver === 'sheetClipNames';
  }

  function loadScenario() {
    const path = resolve(process.cwd(), scenario);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error(`Scenario file ${scenario} has no steps`);
    }
    return parsed;
  }

  function getSteps() {
    if (driver === 'scenario') {
      const parsed = loadScenario();
      scenarioLoop = parsed.loop ?? false;
      return parsed.steps;
    }
    if (driver === 'sheetClipNames') {
      if (typeof getClipNames !== 'function') {
        throw new Error('sim.driver "sheetClipNames" requires the sheets module (M2).');
      }
      return getClipNames().map((clipName) => ({ clipName }));
    }
    return [];
  }

  function canLoop(steps) {
    if (driver === 'sheetClipNames') return steps.length > 0;
    return scenarioLoop;
  }

  let launchIdCounter = 0;

  function emit(clipName, { tempo = null, beat = null } = {}) {
    const tracks = clipName == null ? [] : [{ ...SIM_TRACK, clipName }];
    const sceneBase = clipName == null
      ? makeSceneInfo()
      : sceneFromNowPlayingTracks(tracks, { pendingLaunch: false });
    const scene = clipName == null
      ? sceneBase
      : { ...sceneBase, launchId: ++launchIdCounter };
    const event = makeNowPlaying({
      source: SOURCES.SIMULATOR,
      tracks,
      authoritativeClip: clipName ?? null,
      tempo,
      beat,
      isPlaying: true,
      scene,
    });
    log.info({ authoritativeClip: event.authoritativeClip, simulated: true }, 'now playing (simulated)');
    bus.emit(EVENTS.NOW_PLAYING, event);
    return event;
  }

  function pauseAutoTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function scheduleAuto(delaySeconds) {
    pauseAutoTimer();
    if (paused || !isAutoDriver()) return;
    timer = setTimeout(advanceAuto, delaySeconds * 1000);
  }

  function advanceAuto() {
    if (paused) return;

    const steps = getSteps();
    if (steps.length === 0) {
      if (driver === 'sheetClipNames') {
        log.warn('sheet has no clip names yet; simulator waiting');
        scheduleAuto(intervalSeconds);
      }
      return;
    }

    if (stepIndex >= steps.length) {
      if (!canLoop(steps)) {
        log.info('scenario complete (loop: false); simulator idle');
        pauseAutoTimer();
        emit(null);
        return;
      }
      stepIndex = 0;
    }

    const step = steps[stepIndex];
    stepIndex += 1;
    emit(step.clipName, { tempo: step.tempo ?? null });
    scheduleAuto(step.holdSeconds ?? intervalSeconds);
  }

  function enterPaused() {
    paused = true;
    pauseAutoTimer();
  }

  async function start() {
    log.warn({ driver }, 'SIMULATION MODE active — events are not from Ableton');
    paused = false;
    stepIndex = 0;

    if (driver === 'scenario') {
      scenarioLoop = loadScenario().loop ?? false;
      advanceAuto();
    } else if (driver === 'sheetClipNames') {
      if (typeof getClipNames !== 'function') {
        throw new Error(
          'sim.driver "sheetClipNames" requires the sheets module (M2). Use "scenario" or "manual" for now.'
        );
      }
      advanceAuto();
    } else if (driver === 'manual') {
      paused = true;
      log.info('manual driver ready; fire clips via .fire(clipName)');
    }
  }

  function stop() {
    enterPaused();
  }

  /** Fire a clip on demand; pauses auto-advance. */
  function fire(clipName, opts = {}) {
    enterPaused();
    return emit(clipName, opts);
  }

  /** Clear playing state; pauses auto-advance. */
  function clear() {
    enterPaused();
    return emit(null);
  }

  function pause() {
    enterPaused();
    return getStatus();
  }

  function resume() {
    if (!isAutoDriver()) {
      throw new Error('Auto-advance is not available for the manual driver');
    }
    paused = false;
    scheduleAuto(intervalSeconds);
    return getStatus();
  }

  function step(direction) {
    const steps = getSteps();
    if (steps.length === 0) {
      throw new Error('No clips available to step');
    }

    enterPaused();

    if (direction === 'next') {
      if (stepIndex >= steps.length) {
        if (canLoop(steps)) stepIndex = 0;
        else throw new Error('Already at last step');
      }
      const stepDef = steps[stepIndex];
      stepIndex += 1;
      return emit(stepDef.clipName, { tempo: stepDef.tempo ?? null });
    }

    if (direction === 'prev') {
      let idx = stepIndex - 2;
      if (idx < 0) {
        if (canLoop(steps)) idx = steps.length - 1;
        else idx = 0;
      }
      const stepDef = steps[idx];
      stepIndex = idx + 1;
      return emit(stepDef.clipName, { tempo: stepDef.tempo ?? null });
    }

    throw new Error('direction must be "next" or "prev"');
  }

  function getStatus() {
    let clipNames = [];
    if (isAutoDriver()) {
      try {
        clipNames = getSteps().map((s) => s.clipName);
      } catch {
        clipNames = [];
      }
    }

    return {
      paused,
      driver,
      stepIndex,
      clipNames,
      canAutoAdvance: isAutoDriver(),
    };
  }

  return {
    name: SOURCES.SIMULATOR,
    start,
    stop,
    fire,
    clear,
    pause,
    resume,
    step,
    getStatus,
  };
}
