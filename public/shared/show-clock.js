// Show clock shared by the session log and the timer module.
// Art-Net SMPTE when it is live; otherwise the show-box computer clock.
// Operator browsers project forward from the last server sample. They do not
// substitute their own wall clock.

export const DAY_SECONDS = 24 * 60 * 60;
/** A milestone this far behind does not wrap into "later tonight". */
export const LOOKAHEAD_SECONDS = 18 * 60 * 60;
const EXTRAPOLATE_CAP_SECONDS = 5;

export function formatShowTimecode({ hours, minutes, seconds, frames = 0, dropFrame = false }) {
  const sep = dropFrame ? ';' : ':';
  const pad = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${sep}${pad(frames)}`;
}

export function formatClockFace({ hours, minutes, seconds }) {
  const pad = (n) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function clockParts(hours, minutes, seconds, frames = 0, dropFrame = false) {
  if (hours > 23 || minutes > 59 || seconds > 59 || frames > 29) return null;
  return { hours, minutes, seconds, frames, dropFrame };
}

/**
 * Log stamps (`HH:MM:SS`, `HH:MM:SS:FF`, drop-frame `;FF`) and casual
 * milestone typing (`10pm`, `10:00 pm`, `220000`, `22:00`).
 * @returns {{ hours: number, minutes: number, seconds: number, frames: number, dropFrame: boolean } | null}
 */
export function parseTimecodeDisplay(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const smpte = text.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)(?::([0-2]\d)|;([0-2]\d))?$/);
  if (smpte) {
    return clockParts(
      Number(smpte[1]),
      Number(smpte[2]),
      Number(smpte[3]),
      Number(smpte[4] ?? smpte[5] ?? 0),
      smpte[5] != null,
    );
  }

  const hm = text.match(/^(\d{1,2}):([0-5]\d)$/);
  if (hm) return clockParts(Number(hm[1]), Number(hm[2]), 0);

  const casual = text.match(/^(\d{1,2})(?::([0-5]\d))?(?::([0-5]\d))?\s*([ap])\.?m\.?$/i);
  if (casual) {
    let hours = Number(casual[1]);
    const minutes = Number(casual[2] ?? 0);
    const seconds = Number(casual[3] ?? 0);
    if (hours < 1 || hours > 12) return null;
    const pm = casual[4].toLowerCase() === 'p';
    if (!pm && hours === 12) hours = 0;
    else if (pm && hours !== 12) hours += 12;
    return clockParts(hours, minutes, seconds);
  }

  const digits = text.replace(/\s+/g, '');
  if (/^\d{4}$/.test(digits) || /^\d{6}$/.test(digits)) {
    return clockParts(
      Number(digits.slice(0, 2)),
      Number(digits.slice(2, 4)),
      digits.length === 6 ? Number(digits.slice(4, 6)) : 0,
    );
  }

  return null;
}

export function secondsOfDay(parts, fps = null) {
  const framePart = fps && fps > 1 ? (Number(parts.frames) || 0) / fps : 0;
  return (Number(parts.hours) || 0) * 3600
    + (Number(parts.minutes) || 0) * 60
    + (Number(parts.seconds) || 0)
    + framePart;
}

export function clockFromDate(now) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const parts = { hours, minutes, seconds, frames: 0, dropFrame: false };
  return {
    source: 'clock',
    display: formatShowTimecode(parts),
    ...parts,
    fps: null,
    receivedAt: now.getTime(),
    secondsOfDay: secondsOfDay(parts),
  };
}

/**
 * Same choice as the session log: live Art-Net display, else computer time.
 * @param {object} status timecode listener status
 * @param {Date} [now]
 */
export function resolveShowClock(status, now = new Date()) {
  const tc = status?.timecode;
  if (status?.enabled === true && status?.live === true && tc?.display) {
    const parsed = parseTimecodeDisplay(tc.display) ?? {
      hours: Number(tc.hours) || 0,
      minutes: Number(tc.minutes) || 0,
      seconds: Number(tc.seconds) || 0,
      frames: Number(tc.frames) || 0,
      dropFrame: tc.dropFrame === true,
    };
    const fps = typeof tc.fps === 'number' && tc.fps > 1 ? tc.fps : null;
    return {
      source: 'artnet',
      display: tc.display,
      hours: parsed.hours,
      minutes: parsed.minutes,
      seconds: parsed.seconds,
      frames: parsed.frames,
      dropFrame: parsed.dropFrame,
      fps,
      receivedAt: typeof tc.receivedAt === 'number' ? tc.receivedAt : now.getTime(),
      secondsOfDay: secondsOfDay(parsed, fps),
    };
  }
  return clockFromDate(now);
}

/**
 * Advance a server clock sample by the time since this browser received it.
 * Capped so a stalled socket cannot run the countdown away.
 */
export function projectClock(sample, clientReceivedAt, nowMs = Date.now()) {
  if (!sample || !Number.isFinite(Number(sample.hours))) return null;
  const elapsed = Number.isFinite(clientReceivedAt) && clientReceivedAt > 0
    ? Math.max(0, (nowMs - clientReceivedAt) / 1000)
    : 0;
  const capped = Math.min(elapsed, EXTRAPOLATE_CAP_SECONDS);
  const fps = sample.source === 'artnet' && Number(sample.fps) > 1 ? Number(sample.fps) : null;
  const base = secondsOfDay(sample, fps);
  const total = ((base + capped) % DAY_SECONDS + DAY_SECONDS) % DAY_SECONDS;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const frac = total - Math.floor(total);
  let frames = 0;
  let dropFrame = false;
  if (fps) {
    frames = Math.min(Math.floor(fps) - 1, Math.max(0, Math.floor(frac * fps)));
    dropFrame = sample.dropFrame === true;
  }
  const parts = { hours, minutes, seconds, frames, dropFrame };
  return {
    source: sample.source === 'artnet' ? 'artnet' : 'clock',
    ...parts,
    fps,
    display: formatShowTimecode(parts),
    secondsOfDay: total,
  };
}

function milestoneEntries(milestones) {
  const entries = [];
  const list = Array.isArray(milestones) ? milestones : [];
  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index];
    if (!raw || raw.skip === true || raw.at == null || String(raw.at).trim() === '') continue;
    const parts = parseTimecodeDisplay(raw.at);
    if (!parts) continue;
    entries.push({
      index,
      id: raw.id ?? '',
      label: raw.label ?? '',
      at: formatShowTimecode(parts),
      target: secondsOfDay(parts),
    });
  }
  return entries;
}

/**
 * List order is the show order. A clock time earlier than the previous mark
 * is the next morning (23:00 then 02:00), not a mark that already happened.
 * Returns null when that walk wraps more than once — the list is not one night.
 */
function showTimeline(entries) {
  if (!entries.length) return [];
  const placed = [{ ...entries[0], offset: 0 }];
  let prev = entries[0].target;
  let offset = 0;
  for (let i = 1; i < entries.length; i += 1) {
    const step = (entries[i].target - prev + DAY_SECONDS) % DAY_SECONDS;
    offset += step;
    if (offset >= DAY_SECONDS) return null;
    placed.push({ ...entries[i], offset });
    prev = entries[i].target;
  }
  return placed;
}

function scheduledByLookahead(entries, nowSeconds) {
  const upcoming = [];
  const passed = [];
  for (const entry of entries) {
    const delta = entry.target - nowSeconds;
    const wrapped = delta < 0 ? delta + DAY_SECONDS : delta;
    const isUpcoming = delta >= 0 || wrapped <= LOOKAHEAD_SECONDS;
    const item = {
      id: entry.id,
      label: entry.label,
      at: entry.at,
      delta: isUpcoming ? wrapped : delta,
      index: entry.index,
    };
    if (isUpcoming) upcoming.push(item);
    else passed.push(item);
  }
  upcoming.sort((a, b) => a.delta - b.delta || a.index - b.index);
  passed.sort((a, b) => b.delta - a.delta);
  const next = upcoming[0] ?? null;
  const overtime = upcoming.length ? null : (passed[0] ?? null);
  return {
    next: next && { id: next.id, label: next.label, at: next.at, delta: next.delta },
    overtime: overtime && { id: overtime.id, label: overtime.label, at: overtime.at, delta: overtime.delta },
  };
}

function scheduledFromTimeline(placed, nowSeconds) {
  const origin = placed[0].target;
  const span = placed[placed.length - 1].offset;
  const into = (nowSeconds - origin + DAY_SECONDS) % DAY_SECONDS;
  const pick = (entry, delta) => ({
    id: entry.id,
    label: entry.label,
    at: entry.at,
    delta,
  });

  if (into <= span) {
    let next = null;
    for (const entry of placed) {
      const delta = entry.offset - into;
      if (delta < 0) continue;
      if (!next || delta < next.delta || (delta === next.delta && entry.index < next.index)) {
        next = { ...pick(entry, delta), index: entry.index };
      }
    }
    return {
      next: next && { id: next.id, label: next.label, at: next.at, delta: next.delta },
      overtime: null,
    };
  }

  const sinceEnd = into - span;
  const untilStart = DAY_SECONDS - into;
  const last = placed[placed.length - 1];
  const first = placed[0];
  if (untilStart <= sinceEnd) return { next: pick(first, untilStart), overtime: null };
  return { next: null, overtime: pick(last, -sinceEnd) };
}

function scheduledMilestones(milestones, nowSeconds) {
  const now = ((Number(nowSeconds) % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS;
  const entries = milestoneEntries(milestones);
  if (!entries.length) return { next: null, overtime: null };
  const placed = showTimeline(entries);
  if (!placed) return scheduledByLookahead(entries, now);
  return scheduledFromTimeline(placed, now);
}

export function classifyMilestones(milestones, nowSeconds) {
  return scheduledMilestones(milestones, nowSeconds);
}

/**
 * What the timer module draws.
 * mode: "next" (countdown), "at" (that milestone's clock time), "clock".
 */
export function describeTimer({
  sample,
  clientReceivedAt = 0,
  milestones = [],
  mode = 'next',
  fallbackLabel = 'Clock',
  nowMs = Date.now(),
} = {}) {
  const clock = sample ? projectClock(sample, clientReceivedAt, nowMs) : null;
  if (!clock) {
    return { kind: 'empty', primary: '—', label: fallbackLabel || 'Clock', source: null, mode };
  }
  const source = clock.source === 'artnet' ? 'TC' : 'CLK';
  const face = formatClockFace(clock);
  const showClock = (label) => ({ kind: 'clock', primary: face, label, source, mode });

  if (mode === 'clock') return showClock('Clock');

  const { next, overtime } = scheduledMilestones(milestones, clock.secondsOfDay);
  const target = next ?? overtime;
  if (mode === 'at') {
    if (!target) return showClock(fallbackLabel || 'Clock');
    const parts = parseTimecodeDisplay(target.at);
    return {
      kind: 'at',
      primary: parts ? formatClockFace(parts) : target.at,
      label: target.label || fallbackLabel || 'Clock',
      source,
      mode,
    };
  }

  if (next) {
    return {
      kind: 'countdown',
      primary: `\u2212${formatDuration(Math.max(0, Math.ceil(next.delta - 1e-9)))}`,
      label: next.label || fallbackLabel || 'Next',
      source,
      mode: 'next',
    };
  }
  if (overtime) {
    return {
      kind: 'overtime',
      primary: `+${formatDuration(Math.floor(Math.abs(overtime.delta)))}`,
      label: overtime.label || fallbackLabel || 'Over',
      source,
      mode: 'next',
    };
  }
  return showClock(fallbackLabel || 'Clock');
}
