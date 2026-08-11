import { formatTimecodeDisplay } from '../core/timecode.js';

export function resolveLogTimestamp(getTimecodeStatus) {
  const status = getTimecodeStatus?.() ?? {};
  if (status.enabled === true && status.live === true && status.timecode?.display) {
    return {
      timestamp: status.timecode.display,
      timestampSource: 'artnet',
    };
  }

  const now = new Date();
  return {
    timestamp: formatTimecodeDisplay({
      hours: now.getHours(),
      minutes: now.getMinutes(),
      seconds: now.getSeconds(),
      frames: 0,
      dropFrame: false,
    }),
    timestampSource: 'clock',
  };
}
