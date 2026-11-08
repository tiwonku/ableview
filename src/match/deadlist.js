import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { normalizeClipName } from './normalize.js';

export const MAX_DEADLIST_CLIPS = 200;

function sanitizeClips(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const fromString = typeof entry === 'string';
    const norm = String(fromString ? entry : entry?.norm ?? '').trim();
    const clipName = fromString
      ? norm
      : String(entry?.clipName ?? '').trim() || norm;
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ norm, clipName });
    if (out.length >= MAX_DEADLIST_CLIPS) break;
  }
  return out;
}

/** Clip names that must not auto-match a cue row. In memory, optionally on disk. */
export function createDeadlistStore({ filePath = null, log, cwd = process.cwd() } = {}) {
  let clips = [];
  let onChange = null;

  function resolvedPath() {
    if (!filePath) return null;
    return resolve(cwd, filePath);
  }

  function load() {
    const path = resolvedPath();
    if (!path || !existsSync(path)) return;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));
      clips = sanitizeClips(data?.clips);
      if (clips.length) log?.info({ count: clips.length }, 'match deadlist loaded');
    } catch (err) {
      clips = [];
      log?.warn({ err: err.message }, 'match deadlist unreadable — starting empty');
    }
  }

  function persist() {
    const path = resolvedPath();
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ clips }, null, 2)}\n`, 'utf8');
  }

  function notify() {
    onChange?.();
  }

  load();

  return {
    list() {
      return clips.map((clip) => ({ norm: clip.norm, clipName: clip.clipName }));
    },
    norms() {
      return new Set(clips.map((clip) => clip.norm));
    },
    has(norm) {
      const key = String(norm ?? '').trim();
      return key !== '' && clips.some((clip) => clip.norm === key);
    },
    add(clipName, normalizeOptions) {
      const raw = String(clipName ?? '').trim();
      if (!raw) throw new Error('clipName is required');
      const norm = normalizeClipName(raw, normalizeOptions);
      if (!norm) throw new Error('clip name is empty after normalize');
      const existing = clips.find((clip) => clip.norm === norm);
      if (existing) {
        if (existing.clipName !== raw) {
          existing.clipName = raw;
          persist();
          notify();
        }
        return { norm, clipName: raw };
      }
      if (clips.length >= MAX_DEADLIST_CLIPS) throw new Error('deadlist is full');
      clips.push({ norm, clipName: raw });
      persist();
      notify();
      return { norm, clipName: raw };
    },
    remove(norm) {
      const key = String(norm ?? '').trim();
      if (!key) throw new Error('norm is required');
      const next = clips.filter((clip) => clip.norm !== key);
      if (next.length === clips.length) throw new Error(`deadlist entry not found: ${key}`);
      clips = next;
      persist();
      notify();
      return this.list();
    },
    setOnChange(fn) {
      onChange = typeof fn === 'function' ? fn : null;
    },
  };
}
