import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_OSC_OUT_LOCK = path.join(process.cwd(), 'data', 'osc-out.lock');

export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

export function readOscOutLock(lockPath) {
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
    const pid = Number(raw?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return {
      pid,
      httpPort: raw.httpPort ?? null,
      startedAt: raw.startedAt ?? null,
    };
  } catch {
    return null;
  }
}

function writeLock(lockPath, info) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, `${JSON.stringify(info)}\n`, { flag: 'wx' });
}

export function acquireOscOutLock(lockPath, {
  pid = process.pid,
  httpPort = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (!lockPath) return { ok: true, skipped: true };
  const info = { pid, httpPort, startedAt: now() };
  try {
    writeLock(lockPath, info);
    return { ok: true, info };
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }

  const existing = readOscOutLock(lockPath);
  if (!existing || !pidAlive(existing.pid) || existing.pid === pid) {
    try { unlinkSync(lockPath); } catch { /* stale or ours */ }
    try {
      writeLock(lockPath, info);
      return { ok: true, info, replaced: existing };
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      return { ok: false, existing: readOscOutLock(lockPath) };
    }
  }
  return { ok: false, existing };
}

export function releaseOscOutLock(lockPath, pid = process.pid) {
  if (!lockPath) return false;
  const existing = readOscOutLock(lockPath);
  if (!existing || existing.pid !== pid) return false;
  try {
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}
