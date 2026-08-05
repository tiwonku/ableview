import Fuse from 'fuse.js';
import { EVENTS } from '../core/bus.js';
import { makeCuePayload, makeMatchResult } from '../core/cue-payload.js';
import { normalizeClipName, parseAliases } from './normalize.js';

function buildSearchItems(rows, { matchColumn, aliasColumn }, normalizeOptions) {
  const items = [];
  for (const row of rows) {
    const primary = row.data[matchColumn]?.trim();
    if (primary) {
      items.push({
        row,
        matchedValue: primary,
        viaAlias: false,
        norm: normalizeClipName(primary, normalizeOptions),
      });
    }
    for (const alias of parseAliases(row.data[aliasColumn])) {
      items.push({
        row,
        matchedValue: alias,
        viaAlias: true,
        norm: normalizeClipName(alias, normalizeOptions),
      });
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

export function matchClip(clipName, snapshot, config) {
  const { matchColumn, aliasColumn } = config.sheets;
  const { threshold, normalize: normalizeOptions } = config.match;
  const { syncedAt, stale, rows } = snapshot;

  const simulated = false; // caller sets on payload from NowPlaying source

  if (!clipName?.trim()) {
    return makeCuePayload({
      clipName: clipName ?? null,
      match: makeMatchResult({ matched: false, confidence: 0 }),
      tempo: null,
      beat: null,
      syncedAt,
      stale,
      simulated,
    });
  }

  const items = buildSearchItems(rows, { matchColumn, aliasColumn }, normalizeOptions);
  if (items.length === 0) {
    return makeCuePayload({
      clipName,
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt,
      stale,
      simulated,
    });
  }

  const query = normalizeClipName(clipName, normalizeOptions);

  const prefixMatch = findPrefixMatch(query, items);
  if (prefixMatch) {
    const { item, exact } = prefixMatch;
    const { row, matchedValue, viaAlias } = item;
    return makeCuePayload({
      clipName,
      match: makeMatchResult({
        matched: true,
        confidence: exact ? 1 : PREFIX_MATCH_CONFIDENCE,
        rowId: row.rowId,
        matchedValue,
        viaAlias,
      }),
      row: row.data,
      syncedAt,
      stale,
      simulated,
    });
  }

  const fuse = createFuseIndex(items, threshold);
  const results = fuse.search(query);

  if (results.length === 0) {
    return makeCuePayload({
      clipName,
      match: makeMatchResult({ matched: false, confidence: 0 }),
      syncedAt,
      stale,
      simulated,
    });
  }

  const best = results[0];
  const confidence = scoreToConfidence(best.score);
  const { row, matchedValue, viaAlias } = best.item;

  return makeCuePayload({
    clipName,
    match: makeMatchResult({
      matched: true,
      confidence,
      rowId: row.rowId,
      matchedValue,
      viaAlias,
    }),
    row: row.data,
    syncedAt,
    stale,
    simulated,
  });
}

function nowPlayingKey(event) {
  return JSON.stringify({
    clip: event.authoritativeClip,
    tempo: event.tempo,
    beat: event.beat,
    source: event.source,
    pendingLaunch: event.pendingLaunch ?? false,
  });
}

function clipKey(event) {
  return JSON.stringify({
    clip: event.authoritativeClip,
    source: event.source,
  });
}

export function createMatcher({ config, getConfig, bus, log, getSnapshot }) {
  const resolveConfig = getConfig ?? (() => config);
  let lastKey = null;
  let lastClipKey = null;
  let lastEvent = null;
  let lastPayload = null;
  let ingestLive = true;

  function rebroadcastIngestLive() {
    if (!lastPayload || lastPayload.ingestLive === ingestLive) return;
    lastPayload = { ...lastPayload, ingestLive };
    bus.emit(EVENTS.CUE_PAYLOAD, lastPayload);
  }

  function handleNowPlaying(event, { force = false } = {}) {
    const key = nowPlayingKey(event);
    if (!force && key === lastKey) return;
    lastKey = key;
    lastEvent = event;

    const ck = clipKey(event);
    const transportOnly = !force && lastClipKey === ck && lastPayload != null;

    let payload;
    const simulated = resolveConfig().sim.enabled === true;

    if (transportOnly) {
      payload = {
        ...lastPayload,
        tempo: event.tempo,
        beat: event.beat,
        pendingLaunch: event.pendingLaunch ?? false,
        simulated,
        ingestLive: simulated ? true : ingestLive,
      };
    } else {
      const snapshot = getSnapshot();
      payload = matchClip(event.authoritativeClip, snapshot, resolveConfig());
      payload.tempo = event.tempo;
      payload.beat = event.beat;
      payload.simulated = simulated;
      payload.pendingLaunch = event.pendingLaunch ?? false;
      payload.ingestLive = simulated ? true : ingestLive;
    }
    lastClipKey = ck;
    lastPayload = payload;

    log.info(
      {
        clipName: payload.clipName,
        matched: payload.match.matched,
        confidence: payload.match.confidence,
        rowId: payload.match.rowId ?? null,
        viaAlias: payload.match.viaAlias ?? false,
        stale: payload.stale,
      },
      'cue payload'
    );
    bus.emit(EVENTS.CUE_PAYLOAD, payload);
  }

  bus.on(EVENTS.NOW_PLAYING, handleNowPlaying);

  bus.on(EVENTS.INGEST_STATUS, ({ live }) => {
    ingestLive = live;
    rebroadcastIngestLive();
  });

  return {
    matchClip: (clipName) => matchClip(clipName, getSnapshot(), resolveConfig()),
    rematch: () => {
      if (lastEvent) handleNowPlaying(lastEvent, { force: true });
    },
  };
}
