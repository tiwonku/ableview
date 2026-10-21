import { readSetlistClipNames } from '../setlist/index.js';

/** "default" keeps the scenario / sheet / manual driver. "setlist" walks a named set. */
export function simSource(sim) {
  return sim?.source === 'setlist' ? 'setlist' : 'default';
}

/**
 * Ordered clip steps for sim.source "setlist".
 * Always loops. Titles are the setlist item titles, blank ones dropped.
 */
export function setlistSimSteps(config, cwd = process.cwd()) {
  const directory = config?.setlist?.directory ?? './data/setlists';
  const name = config?.sim?.setlist;
  const result = readSetlistClipNames(directory, name, cwd);
  return {
    steps: result.names.map((clipName) => ({ clipName })),
    loop: true,
    error: result.error,
    setlist: typeof name === 'string' && name.trim() ? name.trim() : null,
  };
}
