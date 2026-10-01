import dgram from 'node:dgram';
import { EVENTS } from '../core/bus.js';

// Deck-bridge UDP ingest (M13b). Own sockets, own bus event.
// NFR-4: parse and update memory on every report; emit only when the
// §6.3 fingerprint or the stale flag changes. Elapsed time and BPM are
// stored for a later poll and do not fan out.

const BIND_ADDRESS = '0.0.0.0';

export function programDeckFingerprint(decks) {
  const rows = Array.isArray(decks) ? decks : [];
  return JSON.stringify(rows.map((deck) => ({
    deckIndex: deck?.deckIndex ?? null,
    loadedTitle: deck?.loaded?.title ?? null,
    playing: deck?.playing === true,
    onAir: deck?.onAir === true,
  })));
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeDeck(deck) {
  if (!deck || typeof deck !== 'object' || Array.isArray(deck)) return null;
  if (!Number.isInteger(deck.deckIndex)) return null;

  let loaded = null;
  if (deck.loaded != null) {
    if (typeof deck.loaded !== 'object' || Array.isArray(deck.loaded)) return null;
    if (typeof deck.loaded.title !== 'string' || !deck.loaded.title.trim()) return null;
    loaded = {
      title: deck.loaded.title,
      artist: typeof deck.loaded.artist === 'string' ? deck.loaded.artist : null,
    };
  }

  return {
    deckIndex: deck.deckIndex,
    loaded,
    playing: deck.playing === true,
    // Bridge copies may still flag a paused deck. On air requires transport.
    onAir: deck.onAir === true && deck.playing === true,
    bpm: finiteOrNull(deck.bpm),
    bpmPercent: finiteOrNull(deck.bpmPercent),
    key: typeof deck.key === 'string' ? deck.key : null,
    elapsedDisplay: typeof deck.elapsedDisplay === 'string' ? deck.elapsedDisplay : null,
  };
}

/**
 * Parse one DeckBridgeReport datagram. Missing optional fields (Swift omits nils)
 * are treated as null. Returns null when the payload is not for this source.
 */
export function parseDeckBridgeReport(raw, expectedSourceId) {
  let text;
  if (Buffer.isBuffer(raw)) text = raw.toString('utf8');
  else if (typeof raw === 'string') text = raw;
  else return null;

  text = text.trim();
  if (!text) return null;

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  if (msg.schemaVersion !== 1) return null;
  if (typeof msg.sourceId !== 'string' || msg.sourceId !== expectedSourceId) return null;
  if (!Array.isArray(msg.decks)) return null;

  const decks = [];
  for (const deck of msg.decks) {
    const normalized = normalizeDeck(deck);
    if (!normalized) return null;
    decks.push(normalized);
  }

  return {
    schemaVersion: 1,
    sourceId: msg.sourceId,
    reportedAt: typeof msg.reportedAt === 'string' ? msg.reportedAt : null,
    decks,
  };
}

function readSources(getConfig) {
  const configured = getConfig()?.externalSources;
  if (!Array.isArray(configured)) return [];
  return configured
    .filter((src) => src && src.type === 'deck-bridge-udp' && typeof src.id === 'string')
    .map((src) => ({
      id: src.id,
      label: typeof src.label === 'string' && src.label.trim() ? src.label : src.id,
      listenPort: src.listenPort,
      staleMs: Number.isFinite(src.staleMs) ? src.staleMs : 3000,
      live: false,
      stale: false,
      lastSeenAt: null,
      lastSeenMs: null,
      decks: [],
      emitKey: null,
      staleTimer: null,
    }));
}

export function createProgramIngest({ getConfig, bus, log }) {
  let sources = [];
  let sockets = [];
  let lastEmitAt = null;
  let announced = false;

  function publicSource(source) {
    return {
      id: source.id,
      label: source.label,
      live: source.live,
      lastSeenAt: source.lastSeenAt,
      stale: source.stale,
      decks: source.decks.map((deck) => ({
        ...deck,
        loaded: deck.loaded ? { ...deck.loaded } : null,
      })),
    };
  }

  function snapshot() {
    return {
      timestamp: lastEmitAt,
      sources: sources.map(publicSource),
    };
  }

  function emitIfChanged(source) {
    const key = `${programDeckFingerprint(source.decks)}|${source.live}|${source.stale}`;
    if (key === source.emitKey) return;
    source.emitKey = key;
    lastEmitAt = new Date().toISOString();
    bus.emit(EVENTS.PROGRAM_DECK_STATE, snapshot());
  }

  function clearStaleTimer(source) {
    if (!source.staleTimer) return;
    clearTimeout(source.staleTimer);
    source.staleTimer = null;
  }

  function scheduleStale(source) {
    clearStaleTimer(source);
    if (!(source.staleMs > 0)) return;
    source.staleTimer = setTimeout(() => {
      source.staleTimer = null;
      if (source.lastSeenMs == null) return;
      if (Date.now() - source.lastSeenMs < source.staleMs) {
        scheduleStale(source);
        return;
      }
      const wasLive = source.live;
      source.live = false;
      source.stale = true;
      if (wasLive) log.info({ sourceId: source.id }, 'deck bridge stale');
      emitIfChanged(source);
    }, source.staleMs);
    source.staleTimer.unref?.();
  }

  function handlePacket(source, msg) {
    const report = parseDeckBridgeReport(msg, source.id);
    if (!report) return;

    const wasLive = source.live;
    source.lastSeenMs = Date.now();
    source.lastSeenAt = new Date(source.lastSeenMs).toISOString();
    source.live = true;
    source.stale = false;
    source.decks = report.decks;
    scheduleStale(source);
    if (!wasLive) log.info({ sourceId: source.id, port: source.listenPort }, 'deck bridge live');
    emitIfChanged(source);
  }

  function onMessage(source, msg) {
    try {
      handlePacket(source, msg);
    } catch (err) {
      log.error({ err: err.message, sourceId: source.id }, 'program ingest packet failed');
    }
  }

  async function bindSource(source) {
    const socket = dgram.createSocket('udp4');
    socket.on('message', (msg) => onMessage(source, msg));
    socket.on('error', (err) => {
      log.error(
        { err: err.message, sourceId: source.id, port: source.listenPort },
        'program ingest socket error',
      );
    });

    try {
      await new Promise((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(source.listenPort, BIND_ADDRESS, () => {
          socket.off('error', reject);
          resolve();
        });
      });
    } catch (err) {
      log.error(
        { err: err.message, sourceId: source.id, port: source.listenPort },
        'program ingest failed to bind — cue lane unchanged',
      );
      try { socket.close(); } catch { /* already closed */ }
      return;
    }

    sockets.push(socket);
    log.info({ sourceId: source.id, port: source.listenPort }, 'listening for deck bridge');
  }

  function publish() {
    lastEmitAt = new Date().toISOString();
    for (const source of sources) {
      source.emitKey = `${programDeckFingerprint(source.decks)}|${source.live}|${source.stale}`;
    }
    announced = sources.length > 0;
    bus.emit(EVENTS.PROGRAM_DECK_STATE, snapshot());
  }

  async function start() {
    const wasAnnounced = announced;
    stop();
    sources = readSources(getConfig);
    if (sources.length === 0) {
      if (wasAnnounced) publish();
      return;
    }
    await Promise.all(sources.map((source) => bindSource(source)));
    publish();
  }

  function stop() {
    for (const source of sources) clearStaleTimer(source);
    for (const socket of sockets) {
      try { socket.close(); } catch { /* already closed */ }
    }
    sockets = [];
    sources = [];
    lastEmitAt = null;
  }

  function getStatus() {
    return snapshot();
  }

  return { start, stop, getStatus };
}
