import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBus, EVENTS } from '../src/core/bus.js';
import { makeNowPlaying, SOURCES } from '../src/core/now-playing.js';
import { createLogger } from '../src/core/logger.js';
import {
  acquireOscOutLock,
  pidAlive,
  releaseOscOutLock,
  shouldStealOscOutLock,
} from '../src/outputs/osc-lock.js';
import { createOscOutput } from '../src/outputs/osc.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function tmpLock() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'ableview-osclock-')), 'osc-out.lock');
}

test('pidAlive is true for this process and false for a dead pid', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(1_000_000_007), false);
});

test('acquireOscOutLock is exclusive until released or the owner dies', () => {
  const lockPath = tmpLock();
  const first = acquireOscOutLock(lockPath, { pid: process.pid, httpPort: 8080 });
  assert.equal(first.ok, true);

  const blocked = acquireOscOutLock(lockPath, { pid: process.pid + 1, httpPort: 8092 });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.existing.pid, process.pid);
  assert.equal(blocked.existing.httpPort, 8080);

  assert.equal(releaseOscOutLock(lockPath, process.pid), true);
  const second = acquireOscOutLock(lockPath, { pid: process.pid + 1, httpPort: 8092 });
  assert.equal(second.ok, true);
  releaseOscOutLock(lockPath, process.pid + 1);
});

test('acquireOscOutLock replaces a stale lock from a dead pid', () => {
  const lockPath = tmpLock();
  writeFileSync(lockPath, `${JSON.stringify({ pid: 1_000_000_007, httpPort: 8092 })}\n`);
  const got = acquireOscOutLock(lockPath, { pid: process.pid, httpPort: 8080 });
  assert.equal(got.ok, true);
  releaseOscOutLock(lockPath, process.pid);
});

test('preferred 8080 may steal OSC lock from a leftover sim port', async () => {
  const { spawn } = await import('node:child_process');
  assert.equal(shouldStealOscOutLock({ pid: 9, httpPort: 8094 }, 8080), true);
  assert.equal(shouldStealOscOutLock({ pid: 9, httpPort: 8080 }, 8094), false);
  assert.equal(shouldStealOscOutLock({ pid: 9, httpPort: 8092 }, 8093), false);

  const lockPath = tmpLock();
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  assert.equal(acquireOscOutLock(lockPath, { pid: holder.pid, httpPort: 8094 }).ok, true);
  const stole = acquireOscOutLock(lockPath, { pid: process.pid, httpPort: 8080 });
  assert.equal(stole.ok, true);
  assert.equal(stole.stole, true);
  holder.kill();
  releaseOscOutLock(lockPath, process.pid);
});

test('createOscOutput skips sending when another instance holds the lock', async () => {
  const { spawn } = await import('node:child_process');
  const lockPath = tmpLock();
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  const held = acquireOscOutLock(lockPath, { pid: holder.pid, httpPort: 8092 });
  assert.equal(held.ok, true);

  const bus = createBus();
  const sent = [];
  const out = createOscOutput({
    getConfig: () => ({
      server: { httpPort: 8093 },
      oscOut: {
        enabled: true,
        destinations: [{ host: '127.0.0.1', port: 11010 }],
        breath: { enabled: true, rateHz: 30 },
      },
      ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
    }),
    bus,
    log: silentLog,
    sendPacket: (packet) => sent.push(packet),
    lockPath,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  await out.start();
  bus.emit(EVENTS.NOW_PLAYING, makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 120,
    beat: 0,
    isPlaying: true,
  }));
  assert.equal(sent.length, 0);

  out.stop();
  holder.kill();
  releaseOscOutLock(lockPath, holder.pid);
});

test('preferred 8080 steals the lock and leftover sim stops sending', async () => {
  const { spawn } = await import('node:child_process');
  const lockPath = tmpLock();
  const busSim = createBus();
  const busLive = createBus();
  const sentSim = [];
  const sentLive = [];
  const dummySim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const dummyLive = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const event = makeNowPlaying({
    source: SOURCES.ABLETONOSC,
    tempo: 120,
    beat: 0,
    isPlaying: true,
  });

  const sim = createOscOutput({
    getConfig: () => ({
      server: { httpPort: 8094 },
      oscOut: {
        enabled: true,
        destinations: [{ host: '127.0.0.1', port: 11010 }],
        breath: { enabled: false },
      },
      ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
    }),
    bus: busSim,
    log: silentLog,
    sendPacket: (packet) => sentSim.push(packet),
    lockPath,
    lockPid: dummySim.pid,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });
  const live = createOscOutput({
    getConfig: () => ({
      server: { httpPort: 8080 },
      oscOut: {
        enabled: true,
        destinations: [{ host: '127.0.0.1', port: 11010 }],
        breath: { enabled: false },
      },
      ingest: { abletonHost: '127.0.0.1', oscSendPort: 11000 },
    }),
    bus: busLive,
    log: silentLog,
    sendPacket: (packet) => sentLive.push(packet),
    lockPath,
    lockPid: dummyLive.pid,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  await sim.start();
  await live.start();
  sentSim.length = 0;
  busSim.emit(EVENTS.NOW_PLAYING, event);
  busLive.emit(EVENTS.NOW_PLAYING, event);
  assert.equal(sentSim.length, 0);
  assert.ok(sentLive.some((p) => p.address.startsWith('/ableview/clock/')));
  assert.equal(live.getStatus().sending, true);
  assert.equal(sim.getStatus().blocked, true);

  sim.stop();
  live.stop();
  dummySim.kill();
  dummyLive.kill();
});
