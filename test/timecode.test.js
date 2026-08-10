import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { createBus, EVENTS } from '../src/core/bus.js';
import { formatTimecodeDisplay, makeTimecode } from '../src/core/timecode.js';
import { buildArtTimeCodePacket, parseArtTimeCodePacket } from '../src/timecode/artnet.js';
import { createTimecodeListener } from '../src/timecode/index.js';
import { DEFAULTS } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';

const silentLog = createLogger();
silentLog.level = 'silent';

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

test('parseArtTimeCodePacket decodes OpTimeCode', () => {
  const packet = buildArtTimeCodePacket({
    hours: 1,
    minutes: 23,
    seconds: 45,
    frames: 12,
    type: 1,
  });

  const tc = parseArtTimeCodePacket(packet);
  assert.ok(tc);
  assert.equal(tc.hours, 1);
  assert.equal(tc.minutes, 23);
  assert.equal(tc.seconds, 45);
  assert.equal(tc.frames, 12);
  assert.equal(tc.type, 1);
  assert.equal(tc.typeLabel, 'EBU');
  assert.equal(tc.fps, 25);
  assert.equal(tc.display, '01:23:45:12');
});

test('parseArtTimeCodePacket skips Art-Net filler bytes after ProtVer', () => {
  const packet = buildArtTimeCodePacket({
    hours: 17,
    minutes: 53,
    seconds: 51,
    frames: 5,
    type: 2,
    filler1: 0x99,
    filler2: 0x88,
  });

  const tc = parseArtTimeCodePacket(packet);
  assert.ok(tc);
  assert.equal(tc.display, '17:53:51;05');
  assert.equal(tc.typeLabel, 'DF');
  assert.equal(tc.fps, 29.97);
});

test('parseArtTimeCodePacket rejects packets shorter than Art-Net 3 layout', () => {
  const packet = buildArtTimeCodePacket({ hours: 17, minutes: 53, seconds: 51, frames: 5, type: 2 });
  assert.equal(parseArtTimeCodePacket(packet.subarray(0, 17)), null);
});

test('parseArtTimeCodePacket rejects non-timecode packets', () => {
  assert.equal(parseArtTimeCodePacket(Buffer.alloc(8)), null);
  const wrongOp = buildArtTimeCodePacket({});
  wrongOp.writeUInt16LE(0x2000, 8);
  assert.equal(parseArtTimeCodePacket(wrongOp), null);
});

test('formatTimecodeDisplay uses semicolon for drop frame', () => {
  assert.equal(
    formatTimecodeDisplay({ hours: 0, minutes: 0, seconds: 0, frames: 0, dropFrame: true }),
    '00:00:00;00',
  );
});

test('createTimecodeListener emits TIMECODE on valid Art-Net packet', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    timecode: { enabled: true, port: listenPort, bindAddress: '127.0.0.1', staleMs: 500 },
  };
  const listener = createTimecodeListener({
    getConfig: () => config,
    bus,
    log: silentLog,
  });

  const statuses = [];
  bus.on(EVENTS.TIMECODE, (status) => statuses.push(status));

  const socket = dgram.createSocket('udp4');
  try {
    await listener.start();
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => resolve());
    });

    const packet = buildArtTimeCodePacket({
      hours: 0,
      minutes: 5,
      seconds: 10,
      frames: 3,
      type: 3,
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for TIMECODE')), 2000);
      bus.once(EVENTS.TIMECODE, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(packet, listenPort, '127.0.0.1', (err) => { if (err) reject(err); });
    });

    assert.ok(statuses.length >= 1);
    const last = statuses.at(-1);
    assert.equal(last.live, true);
    assert.equal(last.timecode.display, '00:05:10:03');
    assert.equal(last.timecode.typeLabel, 'SMPTE');
  } finally {
    socket.close();
    listener.stop();
  }
});

test('createTimecodeListener marks signal stale after staleMs', async () => {
  const bus = createBus();
  const listenPort = await reserveUdpPort();
  const config = {
    ...DEFAULTS,
    timecode: { enabled: true, port: listenPort, bindAddress: '127.0.0.1', staleMs: 40 },
  };
  const listener = createTimecodeListener({
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

    const packet = buildArtTimeCodePacket({ hours: 0, minutes: 0, seconds: 1, frames: 0, type: 0 });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for TIMECODE')), 2000);
      bus.once(EVENTS.TIMECODE, () => {
        clearTimeout(timer);
        resolve();
      });
      socket.send(packet, listenPort, '127.0.0.1', (err) => (err ? reject(err) : undefined));
    });

    assert.equal(listener.getStatus().live, true);

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(listener.getStatus().live, false);
    assert.ok(listener.getStatus().timecode);
  } finally {
    socket.close();
    listener.stop();
  }
});

test('makeTimecode builds display from components', () => {
  const tc = makeTimecode({ hours: 2, minutes: 0, seconds: 0, frames: 0, type: 2 });
  assert.equal(tc.dropFrame, true);
  assert.equal(tc.display, '02:00:00;00');
});
