// DaVinci Resolve timeline-marker EDL.
// `|M:` is the marker name. Note text sits in front of `|C:` on that same
// line, which is what Timeline Markers from EDL loads into Notes.
// Time of day only: each stamp is the session clock, not a video offset.

export const EDL_RATES = [
  { id: '23.976', nominal: 24, exact: 24000 / 1001, dropAllowed: false },
  { id: '24', nominal: 24, exact: 24, dropAllowed: false },
  { id: '25', nominal: 25, exact: 25, dropAllowed: false },
  { id: '29.97', nominal: 30, exact: 30000 / 1001, dropAllowed: true },
  { id: '30', nominal: 30, exact: 30, dropAllowed: false },
  { id: '59.94', nominal: 60, exact: 60000 / 1001, dropAllowed: true },
  { id: '60', nominal: 60, exact: 60, dropAllowed: false },
];

const KIND_ORDER = { song: 0, dope: 1, note: 2 };

const KIND_COLOR = {
  song: 'ResolveColorGreen',
  dope: 'ResolveColorYellow',
  note: 'ResolveColorBlue',
};

const KIND_FALLBACK = {
  song: 'Song',
  dope: 'Dope',
  note: 'Note',
};

const TC_RE = /^(\d{1,2}):(\d{2}):(\d{2})(?::(\d{2})|;(\d{2}))?$/;
const MAX_NAME = 200;
const MAX_DETAIL = 400;
const SHOW_DAY_S = 86400;

export function edlRateById(id) {
  return EDL_RATES.find((item) => item.id === id) ?? EDL_RATES[4];
}

export function dropFrameActive(settings) {
  return edlRateById(settings.rateId).dropAllowed && settings.dropFrame === true;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function dropCount(nominal) {
  return nominal === 60 ? 4 : 2;
}

/** Real frame index → SMPTE. Drop-frame skips the usual two (or four) numbers each minute. */
export function framesToTimecode(frameIndex, nominal, drop) {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || nominal <= 0) return null;
  let frames = frameIndex;
  if (drop) {
    const dropFrames = dropCount(nominal);
    const framesPerMinute = nominal * 60 - dropFrames;
    const framesPer10Minutes = nominal * 60 * 10 - dropFrames * 9;
    const tenMinuteBlocks = Math.floor(frames / framesPer10Minutes);
    const remainder = frames % framesPer10Minutes;
    if (remainder >= dropFrames) {
      frames += dropFrames * 9 * tenMinuteBlocks
        + dropFrames * Math.floor((remainder - dropFrames) / framesPerMinute);
    } else {
      frames += dropFrames * 9 * tenMinuteBlocks;
    }
  }
  const framesInHour = nominal * 3600;
  const hours = Math.floor(frames / framesInHour);
  if (hours > 99) return null;
  const hourFrames = frames % framesInHour;
  const minutes = Math.floor(hourFrames / (nominal * 60));
  const minuteFrames = hourFrames % (nominal * 60);
  const seconds = Math.floor(minuteFrames / nominal);
  const frame = minuteFrames % nominal;
  const sep = drop ? ';' : ':';
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${sep}${pad2(frame)}`;
}

/** SMPTE or `HH:MM:SS` (frame 0) → real frame index in this timebase. */
export function timecodeToFrames(raw, nominal, drop) {
  const match = TC_RE.exec(String(raw ?? '').trim());
  if (match == null || nominal <= 0) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frame = Number(match[4] ?? match[5] ?? '0');
  if (
    !Number.isInteger(hours)
    || !Number.isInteger(minutes)
    || !Number.isInteger(seconds)
    || !Number.isInteger(frame)
    || hours > 23
    || minutes > 59
    || seconds > 59
    || frame >= nominal
  ) {
    return null;
  }
  if (drop) {
    const skipped = dropCount(nominal);
    const minuteOfHour = hours * 60 + minutes;
    if (minuteOfHour % 10 !== 0 && frame < skipped) return null;
    const dropped = skipped * (minuteOfHour - Math.floor(minuteOfHour / 10));
    return ((hours * 60 + minutes) * 60 + seconds) * nominal + frame - dropped;
  }
  return ((hours * 60 + minutes) * 60 + seconds) * nominal + frame;
}

export function parseLogTimestamp(raw) {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?::(\d{2})|;(\d{2}))$/.exec(String(raw ?? '').trim());
  if (match == null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[4] ?? match[5] ?? '0');
  if (hours > 23 || minutes > 59 || seconds > 59 || frames > 99) return null;
  return { hours, minutes, seconds, frames, drop: match[5] != null };
}

function framesInDay(nominal, drop) {
  if (!drop) return nominal * SHOW_DAY_S;
  const last = timecodeToFrames(`23:59:59;${pad2(nominal - 1)}`, nominal, true);
  if (last == null) return nominal * SHOW_DAY_S;
  return last + 1;
}

/**
 * Walk in log order. A clock that jumps backwards while loggedAt moves forward
 * crossed midnight, so later stamps belong to the next day.
 */
export function assignShowDays(items) {
  let day = 0;
  let prevClock = null;
  let prevLogged = null;
  for (const item of items) {
    const tc = item.tc ?? parseLogTimestamp(item.timestamp);
    item.tc = tc;
    if (!tc) {
      item.dayOffset = day;
      continue;
    }
    const clock = tc.hours * 3600 + tc.minutes * 60 + tc.seconds;
    const logged = Date.parse(item.loggedAt ?? '');
    const loggedOk = Number.isFinite(logged);
    // A real midnight falls back by many hours. A short step backwards is a clock glitch.
    if (
      prevClock != null
      && prevClock - clock > 6 * 3600
      && (!loggedOk || !Number.isFinite(prevLogged) || logged >= prevLogged)
    ) {
      day += 1;
    }
    item.dayOffset = day;
    prevClock = clock;
    if (loggedOk) prevLogged = logged;
  }
  return items;
}

function showSeconds(item, nominal) {
  const tc = item.tc ?? parseLogTimestamp(item.timestamp);
  if (!tc || !(nominal > 0)) return null;
  const day = item.dayOffset ?? 0;
  return day * SHOW_DAY_S + tc.hours * 3600 + tc.minutes * 60 + tc.seconds + tc.frames / nominal;
}

function withinFrames(tc, nominal, drop) {
  if (!tc) return null;
  const sep = drop ? ';' : ':';
  const raw = `${pad2(tc.hours)}:${pad2(tc.minutes)}:${pad2(tc.seconds)}${sep}${pad2(tc.frames)}`;
  return timecodeToFrames(raw, nominal, drop);
}

function absoluteFrames(tc, dayOffset, nominal, drop) {
  const within = withinFrames(tc, nominal, drop);
  if (within == null) return null;
  return (dayOffset ?? 0) * framesInDay(nominal, drop) + within;
}

function cleanLine(raw, max) {
  return String(raw ?? '')
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function markerName(kind, raw) {
  const cleaned = cleanLine(raw, MAX_NAME);
  return cleaned.length > 0 ? cleaned : KIND_FALLBACK[kind];
}

function markerDetail(raw) {
  if (raw == null) return null;
  const cleaned = cleanLine(raw, MAX_DETAIL);
  return cleaned.length > 0 ? cleaned : null;
}

function eventLine(index, tcIn, tcOut) {
  const n = String(index).padStart(3, '0');
  return `${n}  001      V     C        ${tcIn} ${tcOut} ${tcIn} ${tcOut}  `;
}

/**
 * Songs, dopes, and notes from one logged set.
 * Song ends are the next song. Moments stay points.
 */
export function sessionEdlDrafts({
  songs = [],
  moments = [],
  includeSongs = true,
  includeDopes = true,
  includeNotes = false,
  noteTaker = '',
  rateId = '30',
} = {}) {
  const nominal = edlRateById(rateId).nominal;
  const taker = String(noteTaker ?? '').trim();
  const timeline = [];

  if (includeSongs) {
    for (const song of songs) {
      const title = String(song?.title ?? '').trim();
      if (!title) continue;
      timeline.push({
        seq: song.seq,
        timestamp: song.timestamp,
        loggedAt: song.loggedAt ?? null,
        kind: 'song',
        name: title,
        detail: null,
      });
    }
  }

  for (const row of moments) {
    const dope = row?.kind === 'dope';
    const note = row?.kind === 'typed';
    if (dope && !includeDopes) continue;
    if (note && !includeNotes) continue;
    if (!dope && !note) continue;
    if (note && taker && row.who !== taker) continue;
    const body = String(row.note ?? '').trim();
    if (note && !body) continue;
    timeline.push({
      seq: row.seq,
      timestamp: row.timestamp,
      loggedAt: row.loggedAt ?? null,
      kind: dope ? 'dope' : 'note',
      name: row.who ?? '',
      detail: dope ? null : body,
    });
  }

  const sequenced = timeline.every((item) => Number.isInteger(item.seq));
  timeline.sort(sequenced
    ? (a, b) => a.seq - b.seq
    : (a, b) => (Date.parse(a.loggedAt ?? '') || 0) - (Date.parse(b.loggedAt ?? '') || 0));
  assignShowDays(timeline);

  let upcoming = null;
  for (let i = timeline.length - 1; i >= 0; i -= 1) {
    const item = timeline[i];
    if (item.kind !== 'song') continue;
    if (upcoming) {
      item.endTc = upcoming.tc;
      item.endDayOffset = upcoming.dayOffset;
      item.endTimestamp = upcoming.timestamp;
    }
    upcoming = item;
  }

  const drafts = [];
  for (const item of timeline) {
    const showS = showSeconds(item, nominal);
    if (showS == null) continue;
    let showEndS = null;
    if (item.kind === 'song' && item.endTc) {
      showEndS = showSeconds({ tc: item.endTc, dayOffset: item.endDayOffset }, nominal);
      if (!(showEndS > showS)) showEndS = null;
    }
    drafts.push({
      kind: item.kind,
      name: item.name,
      detail: item.detail,
      timestamp: item.timestamp ?? null,
      endTimestamp: showEndS == null ? null : (item.endTimestamp ?? null),
      tc: item.tc,
      dayOffset: item.dayOffset ?? 0,
      endTc: showEndS == null ? null : item.endTc,
      endDayOffset: showEndS == null ? null : item.endDayOffset,
      showS,
      showEndS,
    });
  }

  drafts.sort((a, b) => (
    a.showS - b.showS
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || String(a.name).localeCompare(String(b.name))
  ));
  return drafts;
}

export function buildResolveMarkerEdl(drafts, settings, sessionName = '') {
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return { ok: false, error: 'Nothing to export.' };
  }
  const rate = edlRateById(settings.rateId);
  const drop = dropFrameActive(settings);
  const durations = settings.durations === true;
  const title = cleanLine(sessionName, 70);
  const lines = [
    `TITLE: ${title || 'Show markers'}`,
    drop ? 'FCM: DROP FRAME' : 'FCM: NON-DROP FRAME',
    '',
  ];
  let songs = 0;
  let dopes = 0;
  let notes = 0;
  let skipped = 0;
  let index = 1;

  for (const draft of drafts) {
    const frameIn = withinFrames(draft.tc, rate.nominal, drop);
    if (frameIn == null) {
      skipped += 1;
      continue;
    }
    let frameOut = frameIn + 1;
    let frames = 1;
    if (durations && draft.endTc && draft.showEndS > draft.showS) {
      const endWithin = withinFrames(draft.endTc, rate.nominal, drop);
      const startAbs = absoluteFrames(draft.tc, draft.dayOffset, rate.nominal, drop);
      const endAbs = absoluteFrames(draft.endTc, draft.endDayOffset, rate.nominal, drop);
      if (endWithin != null && startAbs != null && endAbs != null && endAbs > startAbs) {
        frameOut = endWithin;
        frames = endAbs - startAbs;
      }
    }
    const tcIn = framesToTimecode(frameIn, rate.nominal, drop);
    const tcOut = framesToTimecode(frameOut, rate.nominal, drop);
    if (tcIn == null || tcOut == null) {
      skipped += 1;
      continue;
    }
    lines.push(eventLine(index, tcIn, tcOut));
    const detail = markerDetail(draft.detail);
    const prefix = detail == null ? ' ' : `${detail} `;
    lines.push(`${prefix}|C:${KIND_COLOR[draft.kind]} |M:${markerName(draft.kind, draft.name)} |D:${String(frames)}`);
    lines.push('');
    index += 1;
    if (draft.kind === 'song') songs += 1;
    else if (draft.kind === 'dope') dopes += 1;
    else notes += 1;
  }

  if (index === 1) {
    return { ok: false, error: 'Those stamps don\'t fit this frame rate.' };
  }
  return { ok: true, text: lines.join('\n'), songs, dopes, notes, skipped };
}

export function buildSessionEdl({
  songs,
  moments,
  includeSongs,
  includeDopes,
  includeNotes,
  noteTaker,
  settings,
  sessionName,
}) {
  const drafts = sessionEdlDrafts({
    songs,
    moments,
    includeSongs,
    includeDopes,
    includeNotes,
    noteTaker,
    rateId: settings?.rateId,
  });
  return buildResolveMarkerEdl(drafts, settings ?? {}, sessionName);
}
