import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { validateConfig, DEFAULTS } from '../src/config/index.js';
import { createOrbitIngest } from '../src/orbit/index.js';
import { parseOrbitMessage } from '../src/orbit/parse.js';

const silentLog = createLogger();
silentLog.level = 'silent';

const NIK = {
  timestamp: 1779651481,
  formattedTimestampGMT: '2026-05-24T19:38:01.000Z',
  memberId: '70bd015b-033e-4582-bbd8-0af16e44c0a7',
  memberName: 'nik',
  rate: 91,
  average: 91,
  calories: 23.587,
  batteryLevel: '100',
  bandId: 'PrettyLights',
  streamerType: 'CREWMEMBER',
  tagMoment: 'measurement',
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(fn, ms = 1500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await delay(10);
  }
  throw new Error('timed out waiting for orbit');
}

function listen() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => resolve(wss));
  });
}

test('parseOrbitMessage keeps measurements and ignores other tag moments', () => {
  const readings = parseOrbitMessage(JSON.stringify([
    NIK,
    { tagMoment: 'emoji', memberId: 'other', memberName: 'skip', rate: 120 },
  ]));
  assert.equal(readings.length, 1);
  assert.equal(readings[0].memberId, NIK.memberId);
  assert.equal(readings[0].memberName, 'nik');
  assert.equal(readings[0].heartRate, 91);
  assert.equal(readings[0].heartRateAvg, 91);
  assert.equal(readings[0].calories, 23.587);
  assert.equal(readings[0].batteryLevel, 100);
  assert.equal(readings[0].bandId, 'PrettyLights');
  assert.equal(readings[0].measuredAt, '2026-05-24T19:38:01.000Z');
});

test('parseOrbitMessage accepts Orbit python repr and filters by band id', () => {
  const raw = `[{'memberId': 'a', 'memberName': 'nik', 'rate': 91, 'average': 90.5, 'batteryLevel': '100', 'bandId': 'PrettyLights', 'tagMoment': 'measurement'}, {'memberId': 'b', 'memberName': 'ada', 'rate': 80, 'bandId': 'Other', 'tagMoment': 'measurement'}]`;
  const readings = parseOrbitMessage(raw, { bandId: 'PrettyLights' });
  assert.equal(readings.length, 1);
  assert.equal(readings[0].memberName, 'nik');
  assert.equal(readings[0].heartRateAvg, 90.5);
  assert.equal(parseOrbitMessage('not a payload'), null);
});

test('orbit config rejects a non-websocket address', () => {
  const config = structuredClone(DEFAULTS);
  config.ingest.authoritative.track = 'Cue';
  config.views = { band: { title: 'Band', fields: [{ column: 'Key' }] } };
  config.orbit.websocketUrl = 'http://127.0.0.1:8765';
  assert.throws(() => validateConfig(config), /orbit\.websocketUrl/);
});

test('orbit ingest stores a batch and emits one event per person', async () => {
  const wss = await listen();
  const events = [];
  const bus = createBus();
  bus.on(EVENTS.ORBIT_HEART_RATE, (reading) => events.push(reading));
  const orbitConfig = {
    enabled: true,
    websocketUrl: `ws://127.0.0.1:${wss.address().port}`,
    bandId: 'PrettyLights',
    staleMs: 15000,
    logHeartRates: false,
  };
  let clock = Date.parse('2026-05-24T19:38:01.000Z');
  const ingest = createOrbitIngest({
    getConfig: () => ({ orbit: orbitConfig }),
    bus,
    log: silentLog,
    now: () => clock,
  });
  const connected = new Promise((resolve) => wss.once('connection', resolve));
  try {
    await ingest.start();
    const socket = await connected;
    socket.send(JSON.stringify([
      NIK,
      { ...NIK, memberId: 'other', memberName: 'ada', bandId: 'Other', rate: 80 },
      { tagMoment: 'emoji', memberId: 'nope', rate: 140 },
    ]));
    await waitUntil(() => ingest.getStatus().participants.length === 1);
    const status = ingest.getStatus();
    assert.equal(status.connected, true);
    assert.equal(status.logHeartRates, false);
    assert.equal(status.participants[0].memberName, 'nik');
    assert.equal(status.participants[0].heartRate, 91);
    assert.equal(status.participants[0].active, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].memberId, NIK.memberId);

    clock += 16000;
    assert.equal(ingest.getStatus().participants[0].active, false);

    socket.send(JSON.stringify([{ ...NIK, rate: 96, average: 94 }]));
    await waitUntil(() => ingest.getStatus().participants[0].heartRate === 96);
    assert.equal(ingest.getStatus().participants[0].active, true);
    assert.equal(events.length, 2);
  } finally {
    ingest.stop();
    await new Promise((resolve) => wss.close(resolve));
  }
});

test('orbit ingest stays disconnected when disabled and retries when the socket is down', async () => {
  const wss = await listen();
  const port = wss.address().port;
  let connections = 0;
  wss.on('connection', () => { connections += 1; });
  const orbitConfig = {
    enabled: false,
    websocketUrl: `ws://127.0.0.1:${port}`,
    bandId: '',
    staleMs: 15000,
    logHeartRates: false,
  };
  const ingest = createOrbitIngest({
    getConfig: () => ({ orbit: orbitConfig }),
    bus: createBus(),
    log: silentLog,
  });
  try {
    await ingest.start();
    await delay(30);
    assert.equal(connections, 0);
    assert.equal(ingest.getStatus().enabled, false);
    await new Promise((resolve) => wss.close(resolve));
    orbitConfig.enabled = true;
    await ingest.start();
    await waitUntil(() => typeof ingest.getStatus().lastError === 'string');
    assert.equal(ingest.getStatus().connected, false);
  } finally {
    ingest.stop();
    if (wss.address()) await new Promise((resolve) => wss.close(resolve));
  }
});

test('the view server does not subscribe to orbit heart-rate events', () => {
  const source = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.equal(source.includes('ORBIT_HEART_RATE'), false);
  assert.equal(source.includes('orbitHeartRate'), false);
});
