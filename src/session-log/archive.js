// Read logged sets from session JSONL. Songs collapse to one marker per title run.
// Match lines carry the whole cue row, so this scans fields instead of parsing each line.

import { createReadStream } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { sanitizeSessionName, sessionFilePath } from './sanitize.js';

const SONG_COLUMN = 'Song Title';

export function jsonStringField(line, key) {
  const needle = `"${key}":`;
  const at = line.indexOf(needle);
  if (at < 0) return undefined;
  let i = at + needle.length;
  if (line.startsWith('null', i)) return null;
  if (line[i] !== '"') return undefined;
  i += 1;
  let out = '';
  while (i < line.length) {
    const c = line[i];
    if (c === '"') return out;
    if (c === '\\') {
      const n = line[i + 1];
      if (n === 'u') {
        const hex = line.slice(i + 2, i + 6);
        const code = Number.parseInt(hex, 16);
        out += Number.isFinite(code) ? String.fromCharCode(code) : '';
        i += 6;
        continue;
      }
      const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
      out += map[n] ?? n ?? '';
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return undefined;
}

function timestampOf(line) {
  const value = jsonStringField(line, 'timestamp');
  return typeof value === 'string' && value ? value : null;
}

function songTitleOf(line) {
  const fromRow = jsonStringField(line, SONG_COLUMN);
  const matchedValue = jsonStringField(line, 'matchedValue');
  const clipName = jsonStringField(line, 'clipName');
  const title = [fromRow, matchedValue, clipName].find((value) => typeof value === 'string' && value.trim());
  return title ? title.trim() : '';
}

/** One match or moment, or null for every other log line. */
export function markerFromLine(line) {
  const event = jsonStringField(line, 'event');
  if (event !== 'match' && event !== 'moment') return null;
  const timestamp = timestampOf(line);
  const loggedAt = jsonStringField(line, 'loggedAt') ?? null;
  if (event === 'moment') {
    const kind = jsonStringField(line, 'kind');
    if (kind !== 'dope' && kind !== 'typed') return null;
    return {
      event,
      timestamp,
      loggedAt: typeof loggedAt === 'string' ? loggedAt : null,
      kind,
      who: jsonStringField(line, 'who') ?? null,
      note: jsonStringField(line, 'note') ?? null,
    };
  }
  return {
    event,
    timestamp,
    loggedAt: typeof loggedAt === 'string' ? loggedAt : null,
    matched: line.includes('"matched":true'),
    pendingLaunch: line.includes('"pendingLaunch":true'),
    title: songTitleOf(line),
  };
}

export function createSummaryState() {
  return {
    firstTimestamp: null,
    lastTimestamp: null,
    dropFrame: false,
    lastTitle: null,
    seq: 0,
    songs: [],
    moments: [],
  };
}

export function acceptSessionLine(line, state) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return state;
  const timestamp = timestampOf(trimmed);
  if (timestamp) {
    if (!state.firstTimestamp) state.firstTimestamp = timestamp;
    state.lastTimestamp = timestamp;
    if (timestamp.includes(';')) state.dropFrame = true;
  }
  const marker = markerFromLine(trimmed);
  if (!marker) return state;
  if (marker.event === 'moment') {
    state.seq += 1;
    state.moments.push({
      seq: state.seq,
      kind: marker.kind,
      who: marker.who,
      note: marker.note,
      timestamp: marker.timestamp,
      loggedAt: marker.loggedAt,
    });
    return state;
  }
  if (!marker.matched || marker.pendingLaunch || !marker.title) return state;
  if (marker.title === state.lastTitle) return state;
  state.lastTitle = marker.title;
  state.seq += 1;
  state.songs.push({
    seq: state.seq,
    title: marker.title,
    timestamp: marker.timestamp,
    loggedAt: marker.loggedAt,
  });
  return state;
}

export function summarizeLines(lines) {
  const state = createSummaryState();
  for (const line of lines) acceptSessionLine(line, state);
  return publicSummary(state);
}

function publicSummary(state) {
  const dopes = state.moments.filter((row) => row.kind === 'dope').length;
  const notes = state.moments.filter((row) => row.kind === 'typed').length;
  return {
    firstTimestamp: state.firstTimestamp,
    lastTimestamp: state.lastTimestamp,
    dropFrame: state.dropFrame,
    songs: state.songs,
    moments: state.moments,
    songCount: state.songs.length,
    dopeCount: dopes,
    noteCount: notes,
  };
}

function yieldToLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export async function summarizeFile(filePath) {
  const state = createSummaryState();
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let seen = 0;
  try {
    for await (const line of lines) {
      seen += 1;
      acceptSessionLine(line, state);
      if (seen % 400 === 0) await yieldToLoop();
    }
  } finally {
    lines.close();
    stream.destroy();
  }
  return publicSummary(state);
}

function isListedName(fileName) {
  if (!fileName.endsWith('.jsonl')) return false;
  if (fileName.startsWith('.')) return false;
  if (fileName.endsWith('.normalized.jsonl')) return false;
  return true;
}

export function createSessionArchive({ getDirectory, loggingName, cwd = process.cwd() }) {
  const cache = new Map();

  function directory() {
    return getDirectory?.() || './data/sessions';
  }

  function resolveName(raw) {
    const name = sanitizeSessionName(raw);
    if (name !== String(raw ?? '').trim()) {
      throw new Error('Session name must be a non-empty string');
    }
    if (name.endsWith('.normalized')) {
      throw new Error('Session name must be a non-empty string');
    }
    return name;
  }

  async function cachedSummary(name, file, fileStat) {
    const key = `${file}:${fileStat.mtimeMs}:${fileStat.size}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const summary = await summarizeFile(file);
    cache.set(key, summary);
    if (cache.size > 80) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    return summary;
  }

  async function list() {
    const dir = resolve(cwd, directory());
    let entries = [];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const active = loggingName?.() ?? null;
    const sessions = [];
    for (const fileName of entries) {
      if (!isListedName(fileName)) continue;
      const name = fileName.slice(0, -'.jsonl'.length);
      let safe = null;
      try {
        safe = resolveName(name);
      } catch {
        continue;
      }
      const { file } = sessionFilePath(directory(), safe, cwd);
      let fileStat;
      try {
        fileStat = await stat(file);
      } catch {
        continue;
      }
      if (!fileStat.isFile()) continue;
      const summary = await cachedSummary(safe, file, fileStat);
      sessions.push({
        name: safe,
        bytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        firstTimestamp: summary.firstTimestamp,
        lastTimestamp: summary.lastTimestamp,
        songCount: summary.songCount,
        dopeCount: summary.dopeCount,
        noteCount: summary.noteCount,
        dropFrame: summary.dropFrame,
        logging: active != null && active === safe,
      });
    }
    sessions.sort((a, b) => (
      Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) || a.name.localeCompare(b.name)
    ));
    return sessions;
  }

  async function read(raw) {
    const name = resolveName(raw);
    const { file } = sessionFilePath(directory(), name, cwd);
    let fileStat;
    try {
      fileStat = await stat(file);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    if (!fileStat.isFile()) return null;
    const summary = await cachedSummary(name, file, fileStat);
    const active = loggingName?.() ?? null;
    return {
      name,
      bytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      logging: active != null && active === name,
      ...summary,
    };
  }

  async function remove(raw) {
    const name = resolveName(raw);
    const { file } = sessionFilePath(directory(), name, cwd);
    try {
      await unlink(file);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
    for (const key of cache.keys()) {
      if (key.startsWith(`${file}:`)) cache.delete(key);
    }
    return { name };
  }

  return { list, read, remove };
}
