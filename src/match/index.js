import Fuse from 'fuse.js';
import { EVENTS } from '../core/bus.js';
import { makeCuePayload, makeMatchResult } from '../core/cue-payload.js';
import { normalizeClipName, parseAliases } from './normalize.js';

function buildSearchItems(rows, sheets, normalizeOptions) {
  const { matchColumn, aliasColumn, alsFolderColumn } = sheets;
  const items = [];
  for (const row of rows) {
    const primary = row.data[matchColumn]?.trim();
    if (primary) {
      items.push({
        row,
        matchedValue: primary,
        viaAlias: false,
        viaAlsFolder: false,
        norm: normalizeClipName(primary, normalizeOptions),
      });
    }
    for (const alias of parseAliases(row.data[aliasColumn])) {
      items.push({
        row,
        matchedValue: alias,
        viaAlias: true,
        viaAlsFolder: false,
        norm: normalizeClipName(alias, normalizeOptions),
      });
    }
    if (alsFolderColumn) {
      const als = row.data[alsFolderColumn]?.trim();
      if (als) {
        items.push({
          row,
          matchedValue: als,
          viaAlias: false,
          viaAlsFolder: true,
          norm: normalizeClipName(als, normalizeOptions),
        });
      }
    }
  }
  return items;
}

function createFuseIndex(items, threshold) {
  return new Fuse(items, {
    keys: ['norm'],
    threshold,
    includeScore: true,
    ignoreLocation: true,
  });
}

function scoreToConfidence(score) {
  return Math.max(0, Math.min(1, 1 - score));
}

const MIN_PREFIX_TITLE_LENGTH = 4;
const PREFIX_MATCH_CONFIDENCE = 0.9;

function findPrefixMatch(query, items) {
  if (!query) return null;

  let best = null;
  for (const item of items) {
    const { norm } = item;
    if (!norm || norm.length < MIN_PREFIX_TITLE_LENGTH) continue;

    const exact = query === norm;
    const prefix = !exact && query.startsWith(`${norm} `);
    if (!exact && !prefix) continue;

    if (!best || norm.length > best.item.norm.length) {
      best = { item, exact };
    }
  }

  return best;
}

function emptyMatch() {
  return makeMatchResult({ matched: false, confidence: 0 });
}

/** Core single-clip match against an in-memory sheet snapshot. */
export function resolveClipMatch(clipName, snapshot, config) {
  const { threshold, normalize: normalizeOptions } = config.match;
  const { rows } = snapshot;

  if (!clipName?.trim()) {
    return { match: emptyMatch(), row: null };
  }

  const items = buildSearchItems(rows, config.sheets, normalizeOptions);
  if (items.length === 0) {
    return { match: emptyMatch(), row: null };
  }

  const query = normalizeClipName(clipName, normalizeOptions);

  const prefixMatch = findPrefixMatch(query, items);
  if (prefixMatch) {
    const { item, exact } = prefixMatch;
    const { row, matchedValue, viaAlias, viaAlsFolder } = item;
    return {
      match: makeMatchResult({
        matched: true,
        confidence: exact ? 1 : PREFIX_MATCH_CONFIDENCE,
        rowId: row.rowId,
        matchedValue,
        viaAlias: viaAlias || viaAlsFolder,
      }),
      row: row.data,
    };
  }

  const fuse = createFuseIndex(items, threshold);
  const results = fuse.search(query);

  if (results.length === 0) {
    return { match: emptyMatch(), row: null };
  }

  const best = results[0];
  const confidence = scoreToConfidence(best.score);
  const { row, matchedValue, viaAlias, viaAlsFolder } = best.item;

  return {
    match: makeMatchResult({
      matched: true,
      confidence,
      rowId: row.rowId,
      matchedValue,
      viaAlias: viaAlias || viaAlsFolder,
    }),
    row: row.data,
  };
}

export function matchClip(clipName, snapshot, config) {
  const { syncedAt, stale } = snapshot;
  const { match, row } = resolveClipMatch(clipName, snapshot, config);

  return makeCuePayload({
    clipName: clipName ?? null,
    match,
    row,
    tempo: null,
    beat: null,
    syncedAt,
    stale,
    simulated: false,
    trackMatches: [],
  });
}

function trackClipCandidates(tracks) {
  return (tracks ?? [])
    .map((t) => ({
      trackIndex: t.trackIndex,
      trackName: t.trackName,
      clipName: t.clipName ?? null,
      slotIndex: t.slotIndex ?? null,
    }));
}

/**
 * Best unique sheet row across playing watched clips (NFR-7: ambiguous → no match).
 */
export function matchBestOfTracks(tracks, snapshot, config) {
  const { syncedAt, stale } = snapshot;
  const minGap = config.match?.minConfidenceGap ?? 0.08;
  const candidates = trackClipCandidates(tracks);
  const trackMatches = [];
  const scored = [];

  for (const track of candidates) {
    if (!track.clipName?.trim()) {
      trackMatches.push({
        trackIndex: track.trackIndex,
        trackName: track.trackName,
        clipName: null,
        matched: false,
        confidence: 0,
        rowId: null,
        matchedValue: null,
        winner: false,
      });
      continue;
    }

    const { match, row } = resolveClipMatch(track.clipName, snapshot, config);
    trackMatches.push({
      trackIndex: track.trackIndex,
      trackName: track.trackName,
      clipName: track.clipName,
      matched: match.matched,
      confidence: match.confidence,
      rowId: match.rowId ?? null,
      matchedValue: match.matchedValue ?? null,
      winner: false,
    });

    if (match.matched) {
      scored.push({
        trackIndex: track.trackIndex,
        clipName: track.clipName,
        match,
        row,
      });
    }
  }

  if (scored.length === 0) {
    return makeCuePayload({
      clipName: null,
      match: emptyMatch(),
      syncedAt,
      stale,
      simulated: false,
      trackMatches,
    });
  }

  scored.sort((a, b) => b.match.confidence - a.match.confidence);
  const best = scored[0];
  const rival = scored.find((s) => s.match.rowId !== best.match.rowId);

  if (rival && best.match.confidence - rival.match.confidence < minGap) {
    return makeCuePayload({
      clipName: null,
      match: emptyMatch(),
      syncedAt,
      stale,
      simulated: false,
      trackMatches,
    });
  }

  for (const tm of trackMatches) {
    if (tm.matched && tm.rowId === best.match.rowId && tm.trackIndex === best.trackIndex) {
      tm.winner = true;
    }
  }

  return makeCuePayload({
    clipName: best.clipName,
    match: best.match,
    row: best.row,
    syncedAt,
    stale,
    simulated: false,
    trackMatches,
  });
}

export function matchNowPlaying(event, snapshot, config) {
  const strategy = config.ingest?.authoritative?.strategy ?? 'bestMatch';
  const tracks = event.tracks ?? [];

  if (strategy === 'bestMatch') {
    const payload = matchBestOfTracks(tracks, snapshot, config);
    // Fall back to authoritative clip when tracks are empty (sim / legacy).
    if (
      !payload.match.matched
      && event.authoritativeClip
      && tracks.every((t) => !t.clipName?.trim())
    ) {
      const single = matchClip(event.authoritativeClip, snapshot, config);
      return {
        ...single,
        trackMatches: payload.trackMatches,
      };
    }
    return payload;
  }

  const payload = matchClip(event.authoritativeClip, snapshot, config);
  // Still annotate watched tracks for Session when using track strategy.
  const annotated = matchBestOfTracks(tracks, snapshot, config);
  payload.trackMatches = annotated.trackMatches.map((tm) => ({
    ...tm,
    winner: Boolean(
      tm.clipName
      && payload.clipName
      && tm.clipName === payload.clipName
      && tm.matched
      && payload.match.matched
      && tm.rowId === payload.match.rowId
    ),
  }));
  return payload;
}

function nowPlayingKey(event) {
  return JSON.stringify({
    clip: event.authoritativeClip,
    tempo: event.tempo,
    beat: event.beat,
    source: event.source,
    pendingLaunch: event.pendingLaunch ?? false,
    tracks: event.tracks ?? [],
  });
}

function matchIdentityKey(event) {
  // Rematch when authoritative clip or any watched clip name changes.
  return JSON.stringify({
    clip: event.authoritativeClip,
    source: event.source,
    tracks: (event.tracks ?? []).map((t) => [t.trackIndex, t.clipName ?? null]),
  });
}

export function createMatcher({ config, getConfig, bus, log, getSnapshot }) {
  const resolveConfig = getConfig ?? (() => config);
  let lastKey = null;
  let lastMatchKey = null;
  let lastEvent = null;
  let lastPayload = null;
  let ingestLive = true;
  let ableton = null;

  function rebroadcastIngestLive() {
    if (!lastPayload) return;
    const nextLive = ingestLive;
    const nextAbleton = ableton;
    const liveSame = lastPayload.ingestLive === nextLive;
    const abletonSame = JSON.stringify(lastPayload.ableton ?? null) === JSON.stringify(nextAbleton);
    if (liveSame && abletonSame) return;
    lastPayload = { ...lastPayload, ingestLive: nextLive, ableton: nextAbleton };
    bus.emit(EVENTS.CUE_PAYLOAD, lastPayload);
  }

  function handleNowPlaying(event, { force = false } = {}) {
    const key = nowPlayingKey(event);
    if (!force && key === lastKey) return;
    lastKey = key;
    lastEvent = event;

    const mk = matchIdentityKey(event);
    const transportOnly = !force && lastMatchKey === mk && lastPayload != null;

    let payload;
    const simulated = resolveConfig().sim.enabled === true;

    if (transportOnly) {
      payload = {
        ...lastPayload,
        tempo: event.tempo,
        beat: event.beat,
        pendingLaunch: event.pendingLaunch ?? false,
        tracks: event.tracks ?? [],
        scene: event.scene ?? null,
        simulated,
        ingestLive: simulated ? true : ingestLive,
        ableton: simulated ? null : ableton,
      };
    } else {
      const snapshot = getSnapshot();
      payload = matchNowPlaying(event, snapshot, resolveConfig());
      payload.tempo = event.tempo;
      payload.beat = event.beat;
      payload.tracks = event.tracks ?? [];
      payload.scene = event.scene ?? null;
      payload.simulated = simulated;
      payload.pendingLaunch = event.pendingLaunch ?? false;
      payload.ingestLive = simulated ? true : ingestLive;
      payload.ableton = simulated ? null : ableton;
    }
    lastMatchKey = mk;
    lastPayload = payload;

    log.info(
      {
        clipName: payload.clipName,
        matched: payload.match.matched,
        confidence: payload.match.confidence,
        rowId: payload.match.rowId ?? null,
        viaAlias: payload.match.viaAlias ?? false,
        stale: payload.stale,
        trackMatches: (payload.trackMatches ?? []).length,
      },
      'cue payload'
    );
    bus.emit(EVENTS.CUE_PAYLOAD, payload);
  }

  bus.on(EVENTS.NOW_PLAYING, handleNowPlaying);

  bus.on(EVENTS.INGEST_STATUS, (status) => {
    ingestLive = status.live;
    ableton = {
      live: status.live,
      lastSeenAt: status.lastSeenAt ?? null,
      trackNames: status.trackNames ?? null,
      cueTrackConfigured: status.cueTrackConfigured ?? null,
      cueTrackFound: status.cueTrackFound ?? null,
    };
    rebroadcastIngestLive();
  });

  return {
    matchClip: (clipName) => matchClip(clipName, getSnapshot(), resolveConfig()),
    rematch: () => {
      if (lastEvent) handleNowPlaying(lastEvent, { force: true });
    },
  };
}
