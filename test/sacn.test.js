import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createBus, EVENTS } from '../src/core/bus.js';
import { makeLiveColorsStatus, maxChannelDelta } from '../src/core/live-colors.js';
import {
  buildE131DataPacket,
  extractSlotColors,
  multicastGroupForUniverse,
  parseE131DataPacket,
  readRgb8,
} from '../src/sacn/e131.js';
import { createSacnListener } from '../src/sacn/index.js';
import { DEFAULTS } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const JAKE_SLOTS = {
  main: { startChannel: 500, label: 'Color Main' },
  secondary: { startChannel: 503, label: 'Color secondary' },
  accent: { startChannel: 506, label: 'Color accent' },
};

function dmxWithSlots({ main, secondary, accent, lookMain, lookSecondary, lookAccent }) {
  const dmx = Buffer.alloc(512);
  const write = (start, rgb) => {
    if (!rgb) return;
    dmx[start - 1] = rgb[0];
    dmx[start] = rgb[1];
    dmx[start + 1] = rgb[2];
  };
  write(500, main);
  write(503, secondary);
  write(506, accent);
  write(491, lookMain);
  write(494, lookSecondary);
  write(497, lookAccent);
  return dmx;
}

function reserveUdpPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = dgram.createSocket('udp4');
    probe.once('error', reject);
    probe.bind(0, host, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('multicastGroupForUniverse maps universe 191 to 239.255.0.191', () => {
  assert.equal(multicastGroupForUniverse(191), '239.255.0.191');
  assert.equal(multicastGroupForUniverse(1), '239.255.0.1');
});

test('parseE131DataPacket round-trips RGB at Jake addresses', () => {
  const dmx = dmxWithSlots({
    main: [10, 20, 30],
    secondary: [40, 50, 60],
    accent: [70, 80, 90],
  });
  const packet = buildE131DataPacket({
    universe: 191,
    dmx,
    sourceName: 'full-ma',
    priority: 102,
    sequence: 3,
  });
  const parsed = parseE131DataPacket(packet);
  assert.ok(parsed);
  assert.equal(parsed.universe, 191);
  assert.equal(parsed.preview, false);
  assert.equal(parsed.sourceName, 'full-ma');
  assert.equal(parsed.priority, 102);
  assert.equal(parsed.startCode, 0);
  assert.deepEqual(readRgb8(parsed.dmx, 500), { r: 10, g: 20, b: 30 });
  assert.deepEqual(extractSlotColors(parsed.dmx, JAKE_SLOTS), {
    main: { r: 10, g: 20, b: 30 },
    secondary: { r: 40, g: 50, b: 60 },
    accent: { r: 70, g: 80, b: 90 },
  });
});

test('parseE131DataPacket flags preview packets', () => {
  const packet = buildE131DataPacket({
    universe: 191,
    dmx: Buffer.alloc(512),
    preview: true,
  });
  const parsed = parseE131DataPacket(packet);
  assert.equal(parsed.preview, true);
});

test('parseE131DataPacket rejects short and non-sACN buffers', () => {
  assert.equal(parseE131DataPacket(Buffer.alloc(8)), null);
  const packet = buildE131DataPacket({ universe: 1, dmx: Buffer.alloc(512) });
  packet.writeUInt32BE(0, 18);
  assert.equal(parseE131DataPacket(packet), null);
});

test('createSacnListener emits LIVE_COLORS for unicast data on the configured universe', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    sacn: {
      ...DEFAULTS.sacn,
      enabled: true,
      port: listenPort,
      bindAddress: '127.0.0.1',
      multicast: false,
      universe: 191,
      staleMs: 500,
      slots: JAKE_SLOTS,
    },
  };
  const listener = createSacnListener({
    getConfig: () => config,
    bus,
    log: silentLog,
  });

  const socket = dgram.createSocket('udp4');
  try {
    await listener.start();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => resolve());
    });

    const packet = buildE131DataPacket({
      universe: 191,
      dmx: dmxWithSlots({
        main: [255, 128, 0],
        secondary: [0, 40, 255],
        accent: [12, 12, 12],
      }),
      sourceName: 'full-ma',
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for LIVE_COLORS')), 2000);
      bus.once(EVENTS.LIVE_COLORS, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(packet, listenPort, '127.0.0.1', (err) => { if (err) reject(err); });
    });

    const status = listener.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.live, true);
    assert.equal(status.universe, 191);
    assert.deepEqual(status.colors.main, { r: 255, g: 128, b: 0 });
    assert.deepEqual(status.colors.secondary, { r: 0, g: 40, b: 255 });
    assert.deepEqual(status.colors.accent, { r: 12, g: 12, b: 12 });
    assert.deepEqual(status.staticColors.main, { r: 0, g: 0, b: 0 });
  } finally {
    socket.close();
    listener.stop();
  }
});

test('createSacnListener ignores preview packets', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    sacn: {
      ...DEFAULTS.sacn,
      enabled: true,
      port: listenPort,
      bindAddress: '127.0.0.1',
      multicast: false,
      universe: 191,
      staleMs: 200,
    },
  };
  const listener = createSacnListener({ getConfig: () => config, bus, log: silentLog });
  const socket = dgram.createSocket('udp4');
  const seen = [];
  bus.on(EVENTS.LIVE_COLORS, (s) => seen.push(s));
  try {
    await listener.start();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => resolve());
    });
    const packet = buildE131DataPacket({
      universe: 191,
      dmx: dmxWithSlots({ main: [1, 2, 3] }),
      preview: true,
    });
    await new Promise((resolve) => {
      socket.send(packet, listenPort, '127.0.0.1', () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(listener.getStatus().live, false);
    assert.equal(seen.filter((s) => s.live).length, 0);
  } finally {
    socket.close();
    listener.stop();
  }
});

test('createSacnListener marks signal stale after staleMs', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    sacn: {
      ...DEFAULTS.sacn,
      enabled: true,
      port: listenPort,
      bindAddress: '127.0.0.1',
      multicast: false,
      universe: 191,
      staleMs: 40,
    },
  };
  const listener = createSacnListener({ getConfig: () => config, bus, log: silentLog });
  const socket = dgram.createSocket('udp4');
  try {
    await listener.start();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => resolve());
    });
    const packet = buildE131DataPacket({
      universe: 191,
      dmx: dmxWithSlots({ main: [9, 9, 9] }),
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for LIVE_COLORS')), 2000);
      bus.once(EVENTS.LIVE_COLORS, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(packet, listenPort, '127.0.0.1', (err) => (err ? reject(err) : undefined));
    });
    assert.equal(listener.getStatus().live, true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(listener.getStatus().live, false);
    assert.ok(listener.getStatus().colors.main);
  } finally {
    socket.close();
    listener.stop();
  }
});

test('createSacnListener reads FX and static buses from independent channels', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    sacn: {
      ...DEFAULTS.sacn,
      enabled: true,
      port: listenPort,
      bindAddress: '127.0.0.1',
      multicast: false,
      universe: 191,
      staleMs: 500,
    },
  };
  const listener = createSacnListener({
    getConfig: () => config,
    bus,
    log: silentLog,
  });
  const socket = dgram.createSocket('udp4');
  try {
    await listener.start();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => resolve());
    });
    const packet = buildE131DataPacket({
      universe: 191,
      dmx: dmxWithSlots({
        main: [255, 0, 0],
        secondary: [0, 255, 0],
        accent: [0, 0, 255],
        lookMain: [8, 16, 32],
        lookSecondary: [1, 2, 3],
        lookAccent: [9, 9, 9],
      }),
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for LIVE_COLORS')), 2000);
      bus.once(EVENTS.LIVE_COLORS, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(packet, listenPort, '127.0.0.1', (err) => { if (err) reject(err); });
    });
    const status = listener.getStatus();
    assert.deepEqual(status.colors.main, { r: 255, g: 0, b: 0 });
    assert.deepEqual(status.staticColors.main, { r: 8, g: 16, b: 32 });
    assert.deepEqual(status.staticColors.accent, { r: 9, g: 9, b: 9 });
    assert.equal(status.moving, true);
  } finally {
    socket.close();
    listener.stop();
  }
});

test('maxChannelDelta and makeLiveColorsStatus stay slot-shaped', () => {
  const a = makeLiveColorsStatus({
    enabled: true,
    live: true,
    colors: { main: { r: 10, g: 0, b: 0 } },
  });
  const b = makeLiveColorsStatus({
    enabled: true,
    live: true,
    colors: { main: { r: 14, g: 0, b: 0 } },
  });
  assert.equal(maxChannelDelta(a.colors, b.colors), 4);
  assert.equal(a.colors.secondary, null);
});
