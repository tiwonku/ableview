import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createBus, EVENTS } from '../src/core/bus.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import { createSacnListener } from '../src/sacn/index.js';
import {
  COLOR_SIM_FX,
  COLOR_SIM_LOOK,
  COLOR_SIM_LOOK_B,
  COLOR_SIM_SOURCE_NAME,
  buildColorSimDmx,
  colorSimIntervalMs,
  colorSimUniverses,
  createSacnLoopback,
  nextColorSimLook,
} from '../src/sacn/loopback.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function reserveUdpPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, host, () => {
      const { port } = socket.address();
      socket.close(() => resolve(port));
    });
  });
}

test('color sim writes look and fx on the configured channels', () => {
  const dmx = buildColorSimDmx({
    slots: {
      main: { startChannel: 20 },
      secondary: { startChannel: 23 },
      accent: { startChannel: 26 },
    },
    staticSlots: {
      main: { startChannel: 10 },
      secondary: { startChannel: 13 },
      accent: { startChannel: 16 },
    },
  });
  assert.deepEqual([...dmx.subarray(9, 12)], COLOR_SIM_LOOK.main);
  assert.deepEqual([...dmx.subarray(19, 22)], COLOR_SIM_FX.main);
  assert.deepEqual([...dmx.subarray(15, 18)], COLOR_SIM_LOOK.accent);
  assert.deepEqual([...dmx.subarray(25, 28)], COLOR_SIM_FX.accent);
});

test('color sim uses the saved look and swaps to look B on the alternate interval', () => {
  const custom = {
    main: [1, 2, 3],
    secondary: [4, 5, 6],
    accent: [7, 8, 9],
  };
  const dmx = buildColorSimDmx({
    sim: { look: custom },
    staticSlots: { main: { startChannel: 10 } },
    slots: { main: { startChannel: 20 } },
  });
  assert.deepEqual([...dmx.subarray(9, 12)], [1, 2, 3]);
  assert.deepEqual([...dmx.subarray(19, 22)], COLOR_SIM_FX.main);

  const state = { index: 0, flippedAt: 0 };
  const sim = { alternate: true, alternateMs: 4000, look: custom };
  assert.deepEqual(nextColorSimLook(sim, state, 1000).main, custom.main);
  assert.deepEqual(nextColorSimLook(sim, state, 4999).main, custom.main);
  assert.deepEqual(nextColorSimLook(sim, state, 5000).main, [...COLOR_SIM_LOOK_B.main]);
  assert.deepEqual(nextColorSimLook(sim, state, 8999).main, [...COLOR_SIM_LOOK_B.main]);
  assert.deepEqual(nextColorSimLook(sim, state, 9000).main, custom.main);
  assert.deepEqual(nextColorSimLook({ alternate: false, look: custom }, state, 9001).main, custom.main);
});

test('color sim interval stays inside the stale window', () => {
  assert.equal(colorSimIntervalMs(1000), 400);
  assert.equal(colorSimIntervalMs(200), 100);
  assert.equal(colorSimIntervalMs(0), 400);
  assert.deepEqual(colorSimUniverses({ universe: 191, staticUniverse: 4 }), [191, 4]);
  assert.deepEqual(colorSimUniverses({ universe: 191, staticUniverse: 191 }), [191]);
});

test('color sim stays off unless the listener and the sim switch are both on', () => {
  const loop = createSacnLoopback({
    getConfig: () => ({ sacn: { enabled: true, sim: { enabled: false } } }),
    log: silentLog,
  });
  loop.start();
  assert.equal(loop.running, false);
  loop.stop();
});

test('loopback unicast reaches the sACN listener as look and fx', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const sacn = {
    ...structuredClone(DEFAULTS.sacn),
    enabled: true,
    sim: { enabled: true },
    port: listenPort,
    bindAddress: '127.0.0.1',
    multicast: false,
    staleMs: 2000,
  };
  const listener = createSacnListener({
    getConfig: () => ({ sacn }),
    bus,
    log: silentLog,
  });
  const loop = createSacnLoopback({
    getConfig: () => ({ sacn }),
    log: silentLog,
  });

  try {
    await listener.start();
    const status = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for color sim')), 2000);
      bus.once(EVENTS.LIVE_COLORS, (next) => {
        clearTimeout(timer);
        resolve(next);
      });
      loop.start();
    });
    assert.equal(status.live, true);
    assert.equal(status.sourceName, COLOR_SIM_SOURCE_NAME);
    assert.equal(status.sourceAddress, '127.0.0.1');
    assert.deepEqual(status.colors.main, { r: 255, g: 0, b: 80 });
    assert.deepEqual(status.colors.secondary, { r: 80, g: 0, b: 255 });
    assert.deepEqual(status.colors.accent, { r: 255, g: 220, b: 0 });
    assert.deepEqual(status.staticColors.main, { r: 255, g: 80, b: 0 });
    assert.deepEqual(status.staticColors.secondary, { r: 0, g: 40, b: 255 });
    assert.deepEqual(status.staticColors.accent, { r: 20, g: 200, b: 80 });
  } finally {
    loop.stop();
    listener.stop();
  }
});

test('validateConfig accepts the color sim switch and rejects a bad one', () => {
  const cfg = structuredClone(DEFAULTS);
  cfg.ingest.authoritative.track = 'Cue';
  cfg.server.httpPort = 8080;
  cfg.views = {
    band: { title: 'Band', fields: [{ column: 'Key' }] },
    admin: { title: 'Admin', system: true },
  };
  cfg.secrets = {
    googleServiceAccountKeyPath: './secrets/service-account.json',
    sheetId: 'abc123',
  };
  assert.equal(cfg.sacn.sim.enabled, false);
  assert.equal(validateConfig(cfg), cfg);
  cfg.sacn.sim.enabled = 'yes';
  assert.throws(() => validateConfig(cfg), /sacn\.sim\.enabled/);
  cfg.sacn.sim.enabled = true;
  cfg.sacn.sim.look = { main: [1, 2, 3], secondary: [0, 0, 0], accent: [255, 255, 255] };
  cfg.sacn.sim.alternateMs = 4000;
  assert.equal(validateConfig(cfg), cfg);
  cfg.sacn.sim.look = { main: [1, 2, 300] };
  assert.throws(() => validateConfig(cfg), /sacn\.sim\.look\.main/);
  cfg.sacn.sim.look = { main: [1, 2, 3] };
  cfg.sacn.sim.alternateMs = 500;
  assert.throws(() => validateConfig(cfg), /sacn\.sim\.alternateMs/);
});
