// Live copy of session-log lines to the show website.
// appendRecord writes the JSONL first and may enqueue; this module never
// runs HTTP, DNS, or file scans on that call.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_LINES = 200;
const MAX_BYTES = 1_000_000;
const MIN_GAP_MS = 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 29;
const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;

const MISSING_CREDENTIALS = 'Set SHOW_CAPTURE_URL and SHOW_CAPTURE_SECRET in .env';

function emptyAck() {
  return { sessions: {} };
}

function readAckFile(filePath) {
  try {
    if (!existsSync(filePath)) return emptyAck();
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const sessions = parsed?.sessions;
    if (!sessions || typeof sessions !== 'object') return emptyAck();
    return { sessions };
  } catch {
    return emptyAck();
  }
}

function writeAckFile(filePath, ack) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(ack)}\n`, 'utf8');
}

export function readJsonlRecords(filePath) {
  try {
    if (!existsSync(filePath)) return [];
    const content = readFileSync(filePath, 'utf8');
    if (!content) return [];
    const records = [];
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // skip a torn last line
      }
    }
    return records;
  } catch {
    return [];
  }
}

function credentialsReady(creds) {
  const url = typeof creds?.url === 'string' ? creds.url.trim() : '';
  const secret = typeof creds?.secret === 'string' ? creds.secret.trim() : '';
  if (!url || !secret) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return { url, secret, host: parsed.host };
  } catch {
    return null;
  }
}

function takeBatch(lines) {
  const ordered = [...lines].sort((a, b) => a.seq - b.seq);
  const batch = [];
  let used = Buffer.byteLength('{"lines":[]}', 'utf8');
  for (const line of ordered) {
    if (batch.length >= MAX_LINES) break;
    const encoded = JSON.stringify(line);
    const bytes = Buffer.byteLength(encoded, 'utf8') + (batch.length > 0 ? 1 : 0);
    if (used + bytes > MAX_BYTES) {
      if (batch.length === 0) return { batch: [], oversized: line };
      break;
    }
    batch.push(line);
    used += bytes;
  }
  return { batch, oversized: null };
}

/**
 * Queued POST of session-log lines. `enqueue` is synchronous and does no I/O.
 */
export function createShowCapture({
  getCredentials,
  log,
  ackPath,
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = MIN_GAP_MS,
} = {}) {
  let enabled = false;
  let authStopped = false;
  let lastError = null;
  let backoffMs = 0;
  let nextAttemptAt = 0;
  let ackLoaded = false;
  let timer = null;
  let flight = null;
  let onChange = null;
  const ack = emptyAck();
  /** @type {Map<string, object[]>} */
  const pending = new Map();
  /** @type {Map<string, Set<string>>} */
  const queuedIds = new Map();
  /** @type {Set<string>} */
  const sessionStopped = new Set();
  const recentRequests = [];

  function resolveAckPath() {
    return typeof ackPath === 'function' ? ackPath() : ackPath;
  }

  function creds() {
    return credentialsReady(typeof getCredentials === 'function' ? getCredentials() : null);
  }

  function setError(message) {
    const next = message == null ? null : String(message).slice(0, 180);
    if (next === lastError) return;
    lastError = next;
    onChange?.();
  }

  function loadAck() {
    if (ackLoaded) return;
    ackLoaded = true;
    const file = resolveAckPath();
    if (!file) return;
    const stored = readAckFile(file);
    ack.sessions = stored.sessions;
  }

  function saveAck() {
    const file = resolveAckPath();
    if (!file) return;
    try {
      writeAckFile(file, ack);
    } catch (err) {
      log?.error?.({ err: err.message }, 'show capture ack write failed');
    }
  }

  function sessionAck(name) {
    const row = ack.sessions[name];
    if (!row || typeof row !== 'object') return { acked: 0, rejected: new Set() };
    const rejected = new Set(Array.isArray(row.rejected) ? row.rejected.map(String) : []);
    const acked = Number.isInteger(row.acked) && row.acked > 0 ? row.acked : 0;
    return { acked, rejected };
  }

  function rememberSession(name, { acked, rejected }) {
    ack.sessions[name] = {
      acked,
      rejected: [...rejected],
    };
  }

  function dropLines(name, lineIds) {
    const drop = new Set(lineIds);
    const list = pending.get(name);
    const ids = queuedIds.get(name);
    if (!list || !ids) return;
    const next = list.filter((line) => !drop.has(line.lineId));
    for (const id of drop) ids.delete(id);
    if (next.length === 0) {
      pending.delete(name);
      queuedIds.delete(name);
      return;
    }
    list.length = 0;
    list.push(...next);
  }

  function markRejected(name, lines) {
    const state = sessionAck(name);
    for (const line of lines) state.rejected.add(line.lineId);
    rememberSession(name, state);
  }

  function allowSend(ts) {
    while (recentRequests.length > 0 && ts - recentRequests[0] >= RATE_WINDOW_MS) {
      recentRequests.shift();
    }
    if (recentRequests.length >= RATE_MAX) {
      nextAttemptAt = Math.max(nextAttemptAt, recentRequests[0] + RATE_WINDOW_MS);
      return false;
    }
    return ts >= nextAttemptAt;
  }

  function bumpBackoff(ts) {
    backoffMs = backoffMs === 0 ? BACKOFF_START_MS : Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    nextAttemptAt = Math.max(nextAttemptAt, ts + backoffMs);
  }

  function nextSession() {
    for (const [name, lines] of pending) {
      if (sessionStopped.has(name)) continue;
      if (lines.length > 0) return name;
    }
    return null;
  }

  function enqueue(record) {
    try {
      if (!enabled || authStopped) return;
      if (!record || typeof record !== 'object') return;
      const name = record.sessionName;
      if (typeof name !== 'string' || name.length === 0) return;
      if (!Number.isInteger(record.seq) || record.seq < 1) return;
      if (typeof record.lineId !== 'string' || record.lineId.length < 1 || record.lineId.length > 128) return;
      if (sessionStopped.has(name)) return;
      const state = sessionAck(name);
      if (state.rejected.has(record.lineId) || record.seq <= state.acked) return;
      let ids = queuedIds.get(name);
      if (!ids) {
        ids = new Set();
        queuedIds.set(name, ids);
      }
      if (ids.has(record.lineId)) return;
      ids.add(record.lineId);
      let list = pending.get(name);
      if (!list) {
        list = [];
        pending.set(name, list);
      }
      list.push(record);
    } catch (err) {
      log?.error?.({ err: err.message }, 'show capture enqueue failed');
    }
  }

  function catchUp(filePath, sessionName) {
    if (!enabled || !filePath || !sessionName) return 0;
    loadAck();
    const state = sessionAck(sessionName);
    const fresh = [];
    for (const record of readJsonlRecords(filePath)) {
      if (!record || typeof record !== 'object') continue;
      if (record.sessionName !== sessionName) continue;
      if (!Number.isInteger(record.seq) || record.seq <= state.acked) continue;
      if (typeof record.lineId !== 'string' || state.rejected.has(record.lineId)) continue;
      fresh.push(record);
    }
    fresh.sort((a, b) => a.seq - b.seq);
    for (const record of fresh) enqueue(record);
    return fresh.length;
  }

  async function postBatch(ready, lines) {
    const response = await fetchImpl(ready.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ready.secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lines }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (typeof response?.text === 'function') {
      try {
        await response.text();
      } catch {
        // status is enough; a dropped body still has a code
      }
    }
    return Number(response?.status ?? 0);
  }

  function rejectOversized(name, line) {
    markRejected(name, [line]);
    dropLines(name, [line.lineId]);
    saveAck();
    setError(`line ${line.lineId} exceeds 1 MB and was not sent`);
    log?.error?.({ sessionName: name, lineId: line.lineId }, 'show capture line exceeds 1 MB');
  }

  async function tick() {
    if (!enabled || authStopped) return;
    const ready = creds();
    if (!ready) return;
    const ts = now();
    if (!allowSend(ts)) return;
    const name = nextSession();
    if (!name) return;
    const { batch, oversized } = takeBatch(pending.get(name) ?? []);
    if (oversized) {
      rejectOversized(name, oversized);
      return;
    }
    if (batch.length === 0) return;

    recentRequests.push(ts);
    nextAttemptAt = ts + MIN_GAP_MS;
    let status = 0;
    try {
      status = await postBatch(ready, batch);
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      bumpBackoff(now());
      setError(timedOut ? 'website timed out, retrying' : 'website unreachable, retrying');
      return;
    }

    if (status === 200) {
      const state = sessionAck(name);
      const maxSeq = batch.reduce((max, line) => Math.max(max, line.seq), state.acked);
      rememberSession(name, { acked: maxSeq, rejected: state.rejected });
      dropLines(name, batch.map((line) => line.lineId));
      saveAck();
      backoffMs = 0;
      if (lastError && lastError.includes('retrying')) setError(null);
      return;
    }

    if (status === 400) {
      markRejected(name, batch);
      dropLines(name, batch.map((line) => line.lineId));
      saveAck();
      setError('website rejected a batch');
      log?.error?.({ sessionName: name, lines: batch.length }, 'show capture batch rejected');
      return;
    }

    if (status === 401) {
      authStopped = true;
      setError('website rejected the capture secret');
      log?.error?.('show capture stopped: secret rejected');
      return;
    }

    if (status === 409) {
      sessionStopped.add(name);
      setError('site stopped this log: seq and lineId diverged');
      log?.error?.({ sessionName: name }, 'show capture stopped: seq and lineId diverged');
      return;
    }

    if (status === 408 || status === 429 || status >= 500) {
      bumpBackoff(now());
      setError(status === 429 ? 'website busy, retrying' : 'website retrying');
      return;
    }

    authStopped = true;
    setError(`website returned ${status || 'no status'}`);
    log?.error?.({ status }, 'show capture stopped');
  }

  function flush() {
    if (flight) return flight;
    flight = tick().finally(() => {
      flight = null;
    });
    return flight;
  }

  function ensureTimer() {
    if (timer || intervalMs <= 0) return;
    timer = setIntervalFn(() => {
      flush().catch((err) => {
        log?.error?.({ err: err.message }, 'show capture tick failed');
      });
    }, intervalMs);
    timer.unref?.();
  }

  function enable() {
    loadAck();
    const ready = creds();
    if (!ready) return { ok: false, error: MISSING_CREDENTIALS };
    authStopped = false;
    sessionStopped.clear();
    backoffMs = 0;
    nextAttemptAt = 0;
    enabled = true;
    setError(null);
    ensureTimer();
    log?.info?.({ host: ready.host }, 'show capture on');
    return { ok: true };
  }

  function disable() {
    enabled = false;
    authStopped = false;
    sessionStopped.clear();
    backoffMs = 0;
    nextAttemptAt = 0;
    pending.clear();
    queuedIds.clear();
    setError(null);
    log?.info?.('show capture off');
  }

  function pendingCount() {
    let count = 0;
    for (const [name, lines] of pending) {
      if (sessionStopped.has(name)) continue;
      count += lines.length;
    }
    return count;
  }

  function getStatus() {
    return {
      enabled,
      configured: creds() != null,
      pending: pendingCount(),
      lastError,
    };
  }

  return {
    start() {
      loadAck();
    },
    stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
    },
    enable,
    disable,
    isEnabled() {
      return enabled;
    },
    enqueue,
    catchUp,
    flush,
    getStatus,
    setOnChange(handler) {
      onChange = handler ?? null;
    },
  };
}
