import { resolveShowClock } from '../../public/shared/show-clock.js';

/** Log lines and the show timer share this clock. */
export function resolveLogTimestamp(getTimecodeStatus, now = new Date()) {
  const clock = resolveShowClock(getTimecodeStatus?.() ?? {}, now);
  return {
    timestamp: clock.display,
    timestampSource: clock.source,
  };
}
