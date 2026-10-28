import WebSocket from 'ws';
import { EVENTS } from '../core/bus.js';
import { parseOrbitMessage } from './parse.js';

// Orbit WebSocket client. Own socket, own bus event.
// NFR-4: parse and update memory on every message. Emit one
// ORBIT_HEART_RATE per measurement. The session log writes a line only
// when logging is on and orbit.logHeartRates is set. Operator views do
// not subscribe.

const RECONNECT_MS = 5000;
const DEFAULT_URL = 'ws://127.0.0.1:8765';
const DEFAULT_STALE_MS = 15000;

function readOrbit(getConfig) {
  const src = getConfig()?.orbit ?? {};
  const url = typeof src.websocketUrl === 'string' && src.websocketUrl.trim()
    ? src.websocketUrl.trim()
    : DEFAULT_URL;
  const bandId = typeof src.bandId === 'string' ? src.bandId.trim() : '';
  const staleMs = Number.isFinite(src.staleMs) && src.staleMs >= 0 ? src.staleMs : DEFAULT_STALE_MS;
  return {
    enabled: src.enabled === true,
    url,
    bandId,
    staleMs,
    logHeartRates: src.logHeartRates === true,
  };
}

export function createOrbitIngest({
  getConfig,
  bus,
  log,
  now = () => Date.now(),
  WebSocketImpl = WebSocket,
}) {
  let running = false;
  let connected = false;
  let lastSeenAt = null;
  let lastError = null;
  let socket = null;
  let reconnectTimer = null;
  const participants = new Map();

  function closeSocket() {
    const current = socket;
    socket = null;
    if (!current) return;
    current.removeAllListeners?.();
    try { current.close(); } catch { /* already closed */ }
    try { current.terminate?.(); } catch { /* already closed */ }
  }

  function clearReconnect() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function stop() {
    running = false;
    connected = false;
    lastSeenAt = null;
    lastError = null;
    clearReconnect();
    closeSocket();
    participants.clear();
  }

  function scheduleReconnect() {
    if (!running) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!running) return;
      openSocket();
    }, RECONNECT_MS);
    reconnectTimer.unref?.();
  }

  function handleMessage(raw) {
    const { bandId } = readOrbit(getConfig);
    const readings = parseOrbitMessage(raw, { bandId });
    if (readings == null) {
      log.debug('ignoring unparseable orbit message');
      return;
    }
    if (readings.length === 0) return;

    const seenMs = now();
    lastSeenAt = new Date(seenMs).toISOString();
    for (const reading of readings) {
      participants.set(reading.memberId, { ...reading, lastUpdatedMs: seenMs });
      bus.emit(EVENTS.ORBIT_HEART_RATE, reading);
    }
  }

  function openSocket() {
    closeSocket();
    connected = false;
    const { url } = readOrbit(getConfig);
    let next;
    try {
      next = new WebSocketImpl(url);
    } catch (err) {
      lastError = err.message;
      log.warn({ err: err.message }, 'orbit websocket unavailable; retrying');
      scheduleReconnect();
      return;
    }
    socket = next;
    next.on('open', () => {
      if (next !== socket) return;
      connected = true;
      lastError = null;
      log.info({ url }, 'orbit connected');
    });
    next.on('message', (data) => {
      if (next !== socket) return;
      try {
        handleMessage(data);
      } catch (err) {
        log.error({ err: err.message }, 'orbit message failed');
      }
    });
    next.on('error', (err) => {
      if (next !== socket) return;
      lastError = err.message;
    });
    next.on('close', () => {
      if (next !== socket) return;
      const wasConnected = connected;
      connected = false;
      socket = null;
      if (!running) return;
      if (wasConnected) log.warn('orbit websocket closed; retrying');
      else log.warn({ err: lastError }, 'orbit websocket unavailable; retrying');
      scheduleReconnect();
    });
  }

  async function start() {
    stop();
    const cfg = readOrbit(getConfig);
    if (!cfg.enabled) return;
    running = true;
    openSocket();
  }

  function getStatus() {
    const cfg = readOrbit(getConfig);
    const seenMs = now();
    const people = [...participants.values()]
      .map((person) => ({
        memberId: person.memberId,
        memberName: person.memberName,
        heartRate: person.heartRate,
        heartRateAvg: person.heartRateAvg,
        batteryLevel: person.batteryLevel,
        active: seenMs - person.lastUpdatedMs <= cfg.staleMs,
        lastSeenAt: new Date(person.lastUpdatedMs).toISOString(),
      }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName));
    return {
      enabled: cfg.enabled,
      connected,
      lastSeenAt,
      lastError: connected ? null : lastError,
      logHeartRates: cfg.logHeartRates,
      participants: people,
    };
  }

  return { start, stop, getStatus };
}
