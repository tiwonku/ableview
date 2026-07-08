import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENTS } from '../../core/bus.js';
import { makeNowPlaying, SOURCES } from '../../core/now-playing.js';

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

  function emit(clipName, { tempo = null, beat = null } = {}) {
    const event = makeNowPlaying({
      source: SOURCES.SIMULATOR,
      tracks: clipName == null ? [] : [{ ...SIM_TRACK, clipName }],
      authoritativeClip: clipName ?? null,
      tempo,
      beat,
    });
    log.info({ authoritativeClip: event.authoritativeClip, simulated: true }, 'now playing (simulated)');
    bus.emit(EVENTS.NOW_PLAYING, event);
    return event;
  }

  function loadScenario() {
    const path = resolve(process.cwd(), scenario);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error(`Scenario file ${scenario} has no steps`);
    }
    return parsed;
  }

  function runScenario() {
    const { steps, loop = false } = loadScenario();
    const next = () => {
      if (stepIndex >= steps.length) {
        if (!loop) {
          log.info('scenario complete (loop: false); simulator idle');
          emit(null);
          return;
        }
        stepIndex = 0;
      }
      const step = steps[stepIndex];
      stepIndex += 1;
      emit(step.clipName, { tempo: step.tempo ?? null });
      // Not unref'd: until the view server (M4) exists, this timer is what
      // keeps the process alive in sim mode.
      timer = setTimeout(next, (step.holdSeconds ?? intervalSeconds) * 1000);
    };
    next();
  }

  function runSheetClipNames() {
    if (typeof getClipNames !== 'function') {
      throw new Error(
        'sim.driver "sheetClipNames" requires the sheets module (M2). Use "scenario" or "manual" for now.'
      );
    }
    const next = () => {
      const names = getClipNames();
      if (names.length === 0) {
        log.warn('sheet has no clip names yet; simulator waiting');
      } else {
        emit(names[stepIndex % names.length]);
        stepIndex += 1;
      }
      timer = setTimeout(next, intervalSeconds * 1000);
    };
    next();
  }

  async function start() {
    log.warn({ driver }, 'SIMULATION MODE active — events are not from Ableton');
    if (driver === 'scenario') runScenario();
    else if (driver === 'sheetClipNames') runSheetClipNames();
    else if (driver === 'manual') log.info('manual driver ready; fire clips via .fire(clipName)');
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return {
    name: SOURCES.SIMULATOR,
    start,
    stop,
    // Manual driver entry point (admin view / control endpoint hooks in here later).
    fire: (clipName, opts) => emit(clipName, opts),
  };
}
