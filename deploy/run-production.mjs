#!/usr/bin/env node
// Cross-platform production entrypoint for OS service managers (M6 deploy kit).
// Forces repo-root cwd and NODE_ENV=production, then starts the app.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(repoRoot);

if (!process.env.NODE_ENV && !process.env.ABLEVIEW_PRODUCTION) {
  process.env.NODE_ENV = 'production';
}

const extraArgs = process.argv.slice(2);
const child = spawn(process.execPath, ['src/index.js', ...extraArgs], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('Failed to start AbleView:', err.message);
  process.exit(1);
});
