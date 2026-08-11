import { join, resolve } from 'node:path';

const MAX_LENGTH = 80;
const UNSAFE = /[\\/:*?"<>|\0]/;

export function sanitizeSessionName(raw) {
  if (raw == null || typeof raw !== 'string') {
    throw new Error('Session name must be a non-empty string');
  }

  if (UNSAFE.test(raw) || raw.includes('..')) {
    throw new Error('Session name must be a non-empty string');
  }

  let name = raw.trim().replace(/\s+/g, '-').replace(/-+/g, '-');
  name = name.replace(UNSAFE, '-');
  name = name.replace(/[^a-zA-Z0-9._-]/g, '-');
  name = name.replace(/^-+|-+$/g, '');

  if (!name || name === '.' || name === '..' || name.includes('..')) {
    throw new Error('Session name must be a non-empty string');
  }
  if (name.length > MAX_LENGTH) {
    name = name.slice(0, MAX_LENGTH);
  }
  return name;
}

export function sessionFilePath(directory, sessionName, cwd = process.cwd()) {
  const dir = resolve(cwd, directory);
  const file = resolve(dir, `${sessionName}.jsonl`);
  if (!file.startsWith(dir)) {
    throw new Error('Invalid session file path');
  }
  return { dir, file, relative: join(directory, `${sessionName}.jsonl`) };
}
