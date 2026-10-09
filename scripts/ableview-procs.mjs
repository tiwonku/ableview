#!/usr/bin/env node
/**
 * List AbleView processes, stop leftover sims, or power-cycle the show port.
 *
 *   npm run procs
 *   npm run stop-extras
 *   npm run restart
 *
 * Keep port is HTTP_PORT from the environment, default 8080.
 * stop-extras never touches the keep port. restart hard-kills that process,
 * waits until the port is free, then starts src/index.js in the foreground.
 *
 * This machine is the show box. Do not stop or restart the process on the
 * keep port unless the user explicitly asks. See AGENTS.md "Show box".
 */
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_KEEP_HTTP_PORT,
  classifyNodeProcess,
  extrasToStop,
  formatProcLine,
  liveToRestart,
} from '../src/ops/ableview-procs.js';

const keepPort = Number(process.env.HTTP_PORT ?? DEFAULT_KEEP_HTTP_PORT);
const stop = process.argv.includes('stop-extras') || process.argv.includes('--stop');
const restart = process.argv.includes('restart');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseJson(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

function listWindows() {
  const procs = parseJson(execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress',
  ], { encoding: 'utf8' }));

  const listens = parseJson(execFileSync('powershell.exe', [
    '-NoProfile',
    '-Command',
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress',
  ], { encoding: 'utf8' }));

  const portsByPid = new Map();
  for (const row of listens) {
    const pid = Number(row.OwningProcess);
    const port = Number(row.LocalPort);
    if (!Number.isInteger(pid) || !Number.isInteger(port)) continue;
    const list = portsByPid.get(pid) ?? [];
    list.push(port);
    portsByPid.set(pid, list);
  }

  return procs.map((row) => ({
    pid: row.ProcessId,
    commandLine: row.CommandLine,
    listenPorts: portsByPid.get(Number(row.ProcessId)) ?? [],
  }));
}

function listUnix() {
  const raw = execFileSync('ps', ['-ax', '-o', 'pid=,args='], { encoding: 'utf8' });
  const rows = [];
  for (const line of raw.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), commandLine: match[2], listenPorts: [] });
  }
  try {
    const ss = execFileSync('ss', ['-ltnp'], { encoding: 'utf8' });
    for (const line of ss.split('\n')) {
      const portMatch = line.match(/:(\d+)\s/);
      const pidMatch = line.match(/pid=(\d+)/);
      if (!portMatch || !pidMatch) continue;
      const row = rows.find((r) => r.pid === Number(pidMatch[1]));
      if (row) row.listenPorts.push(Number(portMatch[1]));
    }
  } catch {
    // ss is optional; classification still works from --sim / npm run sim
  }
  return rows;
}

function listRaw() {
  return process.platform === 'win32' ? listWindows() : listUnix();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portListening(port) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort <= 0) return false;
  if (process.platform === 'win32') {
    const listens = parseJson(execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${safePort} -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort,OwningProcess | ConvertTo-Json -Compress`,
    ], { encoding: 'utf8' }));
    return listens.length > 0;
  }
  try {
    const ss = execFileSync('ss', ['-ltn', `sport = :${safePort}`], { encoding: 'utf8' });
    return ss.split('\n').some((line) => line.includes(`:${safePort}`));
  } catch {
    return false;
  }
}

async function waitUntilPortFree(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!portListening(port)) return true;
    await sleep(200);
  }
  return !portListening(port);
}

function startForeground() {
  console.log(`starting AbleView on :${keepPort}`);
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  child.on('error', (err) => {
    console.error(`failed to start AbleView: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    process.exit(signal ? 1 : (code ?? 0));
  });
}

async function restartLive() {
  const targets = liveToRestart(listRaw(), keepPort)
    .filter((proc) => proc.pid !== process.pid);

  for (const proc of targets) {
    try {
      process.kill(proc.pid, 'SIGKILL');
      console.log(`stopped ${proc.pid} (live :${keepPort})`);
    } catch (err) {
      if (err.code === 'ESRCH') continue;
      console.error(`failed to stop ${proc.pid}: ${err.message}`);
      process.exit(1);
    }
  }

  if (!(await waitUntilPortFree(keepPort))) {
    console.error(`:${keepPort} still in use — AbleView not started`);
    process.exit(1);
  }
  startForeground();
}

if (restart) {
  restartLive().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  const classified = listRaw()
    .map((row) => classifyNodeProcess(row, keepPort))
    .filter(Boolean);

  if (!classified.length) {
    console.log(`No AbleView node processes (keep :${keepPort})`);
    process.exit(0);
  }

  console.log(`pid\tports\tkind\trole  (keep :${keepPort})`);
  for (const proc of classified) console.log(formatProcLine(proc));

  if (!stop) process.exit(0);

  const extras = extrasToStop(classified.map((p) => ({
    pid: p.pid,
    commandLine: p.commandLine,
    listenPorts: p.listenPorts,
  })), keepPort);

  if (!extras.length) {
    console.log('Nothing to stop');
    process.exit(0);
  }

  for (const proc of extras) {
    try {
      process.kill(proc.pid);
      console.log(`stopped ${proc.pid} (${proc.kind})`);
    } catch (err) {
      console.error(`failed to stop ${proc.pid}: ${err.message}`);
    }
  }
}
