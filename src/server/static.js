import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../public');

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
});

export function publicPath(...segments) {
  return join(PUBLIC_ROOT, ...segments);
}

export async function readPublicFile(relPath) {
  const normalized = normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(PUBLIC_ROOT, normalized);
  if (!filePath.startsWith(PUBLIC_ROOT)) {
    throw Object.assign(new Error('path outside public root'), { code: 'EINVAL' });
  }
  const content = await readFile(filePath);
  const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
  return { content, mime };
}
