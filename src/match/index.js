import Fuse from 'fuse.js';
import { EVENTS } from '../core/bus.js';
import { SOURCES } from '../core/now-playing.js';
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

  const fuse = createFuseIndex(items, threshold);
  const query = normalizeClipName(clipName, normalizeOptions);
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
  });
}

export function createMatcher({ config, bus, log, getSnapshot }) {
  let lastKey = null;

  function handleNowPlaying(event) {
    const key = nowPlayingKey(event);
    if (key === lastKey) return;
    lastKey = key;

    const snapshot = getSnapshot();
    const payload = matchClip(event.authoritativeClip, snapshot, config);
    payload.tempo = event.tempo;
    payload.beat = event.beat;
    payload.simulated = event.source === SOURCES.SIMULATOR;

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

  return { matchClip: (clipName) => matchClip(clipName, getSnapshot(), config) };
}
