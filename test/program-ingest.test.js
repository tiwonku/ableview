import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import dgram from 'node:dgram';
import { createBus, EVENTS } from '../src/core/bus.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';
import { createLogger } from '../src/core/logger.js';
import {
  createProgramIngest,
  parseDeckBridgeReport,
  programDeckFingerprint,
} from '../src/program/index.js';

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

function deck(overrides = {}) {
  return {
    deckIndex: 1,
    loaded: { title: 'What It Sounds Like', artist: 'HUNTR/X' },
    playing: true,
    onAir: true,
    bpm: 124,
    bpmPercent: 0,
    key: 'e minor',
    elapsedDisplay: '01:35',
    ...overrides,
  };
}

function report(sourceId, decks, extra = {}) {
  return {
    schemaVersion: 1,
    sourceId,
    reportedAt: '2026-08-11T02:15:04.512Z',
    bridgeVersion: '0.1.0',
    app: { name: 'djay-pro', running: true },
    crossfader: 0.35,
    decks,
    ...extra,
  };
}

function encode(payload) {
  return Buffer.from(`${JSON.stringify(payload)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(fn, ms = 1500) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await delay(10);
  }
  throw new Error('timed out waiting for program ingest');
}

async function openSender() {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(() => resolve());
  });
  return socket;
}

function sendTo(socket, port, payload) {
  const data = Buffer.isBuffer(payload) ? payload : encode(payload);
  return new Promise((resolve, reject) => {
    socket.send(data, port, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
}

async function listen(sources) {
  const bus = createBus();
  const events = [];
  const cueEvents = [];
  bus.on(EVENTS.PROGRAM_DECK_STATE, (state) => events.push(state));
  bus.on(EVENTS.NOW_PLAYING, (state) => cueEvents.push(state));
  const ingest = createProgramIngest({
    getConfig: () => ({ externalSources: sources }),
    bus,
    log: silentLog,
  });
  await ingest.start();
  return { bus, events, cueEvents, ingest };
}

test('parseDeckBridgeReport trims the trailing newline and accepts omitted nils', () => {
  const raw = Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    sourceId: 'djay-d',
    reportedAt: '2026-08-11T02:15:04.512Z',
    bridgeVersion: '0.1.0',
    app: { name: 'djay-pro', running: true },
    decks: [
      { deckIndex: 1, loaded: { title: 'Song' }, playing: true, onAir: false },
      { deckIndex: 2, playing: false, onAir: false },
    ],
  })}\n`);
  const parsed = parseDeckBridgeReport(raw, 'djay-d');
  assert.equal(parsed.decks[0].loaded.title, 'Song');
  assert.equal(parsed.decks[0].loaded.artist, null);
  assert.equal(parsed.decks[0].bpm, null);
  assert.equal(parsed.decks[0].elapsedDisplay, null);
  assert.equal(parsed.decks[1].loaded, null);
  assert.equal(parseDeckBridgeReport(raw, 'tt-samples'), null);
  assert.equal(parseDeckBridgeReport(Buffer.from('not-json\n'), 'djay-d'), null);
});

test('a paused deck is not on air even when the bridge says so', () => {
  const paused = parseDeckBridgeReport(JSON.stringify(report('djay-d', [
    deck({ playing: false, onAir: true }),
  ])), 'djay-d');
  assert.equal(paused.decks[0].playing, false);
  assert.equal(paused.decks[0].onAir, false);

  const playing = parseDeckBridgeReport(JSON.stringify(report('djay-d', [
    deck({ playing: true, onAir: true }),
  ])), 'djay-d');
  assert.equal(playing.decks[0].onAir, true);
});

test('programDeckFingerprint ignores elapsed and bpm', () => {
  const a = [deck({ elapsedDisplay: '01:00', bpm: 120 })];
  const b = [deck({ elapsedDisplay: '01:05', bpm: 140 })];
  const c = [deck({ onAir: false })];
  assert.equal(programDeckFingerprint(a), programDeckFingerprint(b));
  assert.notEqual(programDeckFingerprint(a), programDeckFingerprint(c));
});

test('identical and elapsed-only reports emit once; title and on-air emit again', async () => {
  const port = await reserveUdpPort();
  const { events, cueEvents, ingest } = await listen([{
    id: 'djay-d',
    label: 'D',
    type: 'deck-bridge-udp',
    listenPort: port,
    staleMs: 5000,
    expectedDecks: 2,
  }]);
  const socket = await openSender();
  try {
    assert.equal(events.length, 1);
    assert.equal(events[0].sources[0].id, 'djay-d');
    assert.equal(events[0].sources[0].live, false);
    assert.deepEqual(events[0].sources[0].decks, []);

    const first = report('djay-d', [deck({ elapsedDisplay: '01:00', bpm: 120 })]);
    await sendTo(socket, port, first);
    await waitUntil(() => events.length >= 2);
    assert.equal(events.length, 2);
    assert.equal(events[1].sources[0].id, 'djay-d');
    assert.equal(events[1].sources[0].live, true);
    assert.equal(events[1].sources[0].stale, false);
    assert.equal(events[1].sources[0].decks[0].loaded.title, 'What It Sounds Like');
    assert.equal(cueEvents.length, 0);

    await sendTo(socket, port, first);
    await sendTo(socket, port, report('djay-d', [deck({ elapsedDisplay: '01:05', bpm: 140 })]));
    await delay(100);
    assert.equal(events.length, 2);
    assert.equal(ingest.getStatus().sources[0].decks[0].elapsedDisplay, '01:05');
    assert.equal(ingest.getStatus().sources[0].decks[0].bpm, 140);

    await sendTo(socket, port, report('djay-d', [deck({
      loaded: { title: 'My Way', artist: 'KATSEYE' },
      elapsedDisplay: '00:01',
    })]));
    await waitUntil(() => events.length >= 3);
    assert.equal(events.length, 3);
    assert.equal(events[2].sources[0].decks[0].loaded.title, 'My Way');

    await sendTo(socket, port, report('djay-d', [deck({
      loaded: { title: 'My Way', artist: 'KATSEYE' },
      onAir: false,
      playing: true,
    })]));
    await waitUntil(() => events.length >= 4);
    assert.equal(events.length, 4);
    assert.equal(events[3].sources[0].decks[0].onAir, false);
    assert.equal(cueEvents.length, 0);
  } finally {
    socket.close();
    ingest.stop();
  }
});

test('two source ids on two ports aggregate independently', async () => {
  const portA = await reserveUdpPort();
  const portB = await reserveUdpPort();
  const { events, ingest } = await listen([
    { id: 'djay-d', label: 'D', type: 'deck-bridge-udp', listenPort: portA, staleMs: 5000 },
    { id: 'tt-samples', label: 'Turntables', type: 'deck-bridge-udp', listenPort: portB, staleMs: 5000 },
  ]);
  const socket = await openSender();
  try {
    await sendTo(socket, portA, report('djay-d', [deck()]));
    await sendTo(socket, portB, report('tt-samples', [deck({
      deckIndex: 1,
      loaded: { title: 'Scratch Loop', artist: null },
      onAir: false,
      playing: false,
    })]));
    await waitUntil(() => events.at(-1)?.sources?.every((source) => source.live));
    assert.equal(events.length, 3);
    const latest = events[2];
    assert.deepEqual(latest.sources.map((s) => s.id), ['djay-d', 'tt-samples']);
    const d = latest.sources.find((s) => s.id === 'djay-d');
    const tt = latest.sources.find((s) => s.id === 'tt-samples');
    assert.equal(d.decks[0].loaded.title, 'What It Sounds Like');
    assert.equal(d.live, true);
    assert.equal(tt.decks[0].loaded.title, 'Scratch Loop');
    assert.equal(tt.label, 'Turntables');
    assert.equal(tt.live, true);

    const before = events.length;
    await sendTo(socket, portA, report('tt-samples', [deck({ loaded: { title: 'Wrong Port' } })]));
    await sendTo(socket, portA, Buffer.from('not-json\n'));
    await delay(100);
    assert.equal(events.length, before);
    assert.equal(ingest.getStatus().sources[0].decks[0].loaded.title, 'What It Sounds Like');
  } finally {
    socket.close();
    ingest.stop();
  }
});

test('a source goes stale after silence and keeps the last decks', async () => {
  const port = await reserveUdpPort();
  const { events, ingest } = await listen([{
    id: 'djay-d',
    label: 'D',
    type: 'deck-bridge-udp',
    listenPort: port,
    staleMs: 50,
  }]);
  const socket = await openSender();
  try {
    await sendTo(socket, port, report('djay-d', [deck()]));
    await waitUntil(() => events.some((state) => state.sources[0].live));
    assert.equal(events.at(-1).sources[0].stale, false);
    await waitUntil(() => events.some((state) => state.sources[0].stale), 500);
    assert.equal(events.length, 3);
    assert.equal(events[2].sources[0].live, false);
    assert.equal(events[2].sources[0].stale, true);
    assert.equal(events[2].sources[0].decks[0].loaded.title, 'What It Sounds Like');
    assert.equal(ingest.getStatus().sources[0].stale, true);
  } finally {
    socket.close();
    ingest.stop();
  }
});

test('no external sources binds nothing and emits nothing', async () => {
  const { events, ingest } = await listen([]);
  try {
    await delay(20);
    assert.equal(events.length, 0);
    assert.deepEqual(ingest.getStatus().sources, []);
  } finally {
    ingest.stop();
  }
});

test('validateConfig accepts deck-bridge sources and rejects collisions', () => {
  const ok = structuredClone(DEFAULTS);
  ok.externalSources = [
    { id: 'djay-d', label: 'D', type: 'deck-bridge-udp', listenPort: 9101, staleMs: 3000, expectedDecks: 2 },
    { id: 'tt-samples', label: 'Turntables', type: 'deck-bridge-udp', listenPort: 9102, staleMs: 3000, expectedDecks: 2 },
  ];
  assert.equal(validateConfig(ok), ok);

  const dupPort = structuredClone(ok);
  dupPort.externalSources[1].listenPort = 9101;
  assert.throws(() => validateConfig(dupPort), /listenPort must be unique/);

  const oscPort = structuredClone(ok);
  oscPort.externalSources[0].listenPort = oscPort.ingest.oscListenPort;
  assert.throws(() => validateConfig(oscPort), /collides with another AbleView listener/);

  const badType = structuredClone(ok);
  badType.externalSources[0].type = 'abletonosc-remote';
  assert.throws(() => validateConfig(badType), /deck-bridge-udp/);
});

test('cue matcher does not subscribe to program state', () => {
  const matchSrc = readFileSync(new URL('../src/match/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(matchSrc, /PROGRAM_DECK_STATE/);
  assert.doesNotMatch(matchSrc, /programDeckState/);
});

test('view server pushes program state to the admin socket only', () => {
  const serverSrc = readFileSync(new URL('../src/server/index.js', import.meta.url), 'utf8');
  assert.match(serverSrc, /EVENTS\.PROGRAM_DECK_STATE/);
  assert.match(serverSrc, /viewId === 'admin' && ws\.readyState === ws\.OPEN/);
});
