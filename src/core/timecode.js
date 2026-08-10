// Timecode contract — Art-Net SMPTE ingest → admin status / future session logger.

export const FRAME_TYPES = Object.freeze({
  0: { label: 'Film', fps: 24, dropFrame: false },
  1: { label: 'EBU', fps: 25, dropFrame: false },
  2: { label: 'DF', fps: 29.97, dropFrame: true },
  3: { label: 'SMPTE', fps: 30, dropFrame: false },
});

export function frameTypeInfo(type) {
  return FRAME_TYPES[type] ?? { label: 'Unknown', fps: null, dropFrame: false };
}

export function makeTimecode({
  hours,
  minutes,
  seconds,
  frames,
  type,
  receivedAt = Date.now(),
}) {
  const info = frameTypeInfo(type);
  return {
    hours,
    minutes,
    seconds,
    frames,
    type,
    fps: info.fps,
    dropFrame: info.dropFrame,
    typeLabel: info.label,
    receivedAt,
    display: formatTimecodeDisplay({ hours, minutes, seconds, frames, dropFrame: info.dropFrame }),
  };
}

export function formatTimecodeDisplay({ hours, minutes, seconds, frames, dropFrame = false }) {
  const sep = dropFrame ? ';' : ':';
  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  const s = String(seconds).padStart(2, '0');
  const f = String(frames).padStart(2, '0');
  return `${h}:${m}:${s}${sep}${f}`;
}

export function makeTimecodeStatus({
  enabled,
  live = false,
  lastSeenAt = null,
  timecode = null,
}) {
  return {
    enabled: enabled === true,
    live: live === true,
    lastSeenAt,
    timecode,
  };
}
