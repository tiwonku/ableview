import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBus, EVENTS } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS } from '../src/config/index.js';
import { createViewServer } from '../src/server/index.js';
import { resolveLogTimestamp } from '../src/session-log/timestamp.js';
import {
  classifyMilestones,
  describeTimer,
  parseTimecodeDisplay,
  projectClock,
  resolveShowClock,
} from '../public/shared/show-clock.js';

const silentLog = createLogger();
silentLog.level = 'silent';

test('parseTimecodeDisplay accepts log-style stamps', () => {
  assert.deepEqual(parseTimecodeDisplay('20:04:12'), {
    hours: 20, minutes: 4, seconds: 12, frames: 0, dropFrame: false,
  });
  assert.equal(parseTimecodeDisplay('20:04:12;08').dropFrame, true);
  assert.equal(parseTimecodeDisplay('25:00:00'), null);
  assert.equal(parseTimecodeDisplay('13pm'), null);
});

test('casual milestone times share one clock value', () => {
  const forms = ['22:00:00', '22:00', '2200', '220000', '10:00pm', '10pm', '10 pm', '10:00 PM'];
  for (const form of forms) {
    const parsed = parseTimecodeDisplay(form);
    assert.ok(parsed, form);
    assert.equal(parsed.hours, 22, form);
    assert.equal(parsed.minutes, 0, form);
    assert.equal(parsed.seconds, 0, form);
  }
  assert.equal(parseTimecodeDisplay('8pm').hours, 20);
  assert.equal(parseTimecodeDisplay('12am').hours, 0);
  assert.equal(parseTimecodeDisplay('12pm').hours, 12);
  assert.equal(parseTimecodeDisplay('12:30am').hours, 0);
  assert.equal(parseTimecodeDisplay('12:30am').minutes, 30);
});

test('resolveShowClock matches the session log', () => {
  const artnet = {
    enabled: true,
    live: true,
    timecode: { display: '01:02:03:04', hours: 1, minutes: 2, seconds: 3, frames: 4, fps: 30 },
  };
  const clock = resolveShowClock(artnet, new Date('2026-10-20T18:00:00'));
  const logged = resolveLogTimestamp(() => artnet, new Date('2026-10-20T18:00:00'));
  assert.equal(clock.source, 'artnet');
  assert.equal(clock.display, '01:02:03:04');
  assert.equal(logged.timestamp, clock.display);
  assert.equal(logged.timestampSource, 'artnet');

  const fallback = resolveShowClock({ enabled: true, live: false }, new Date(2026, 9, 20, 18, 5, 6));
  assert.equal(fallback.source, 'clock');
  assert.equal(fallback.display, '18:05:06:00');
});

test('countdown wraps midnight and then shows overtime', () => {
  const sample = {
    source: 'clock',
    hours: 23,
    minutes: 40,
    seconds: 0,
    frames: 0,
    fps: null,
  };
  const milestones = [
    { id: 'show-start', label: 'Show start', at: '20:00:00:00' },
    { id: 'curfew', label: 'Curfew', at: '00:30:00:00' },
    { id: 'set-break', label: 'Set break', at: '21:00:00:00', skip: true },
  ];
  const nowMs = 5_000_000;
  const view = describeTimer({
    sample,
    clientReceivedAt: nowMs,
    milestones,
    mode: 'next',
    nowMs,
  });
  assert.equal(view.kind, 'countdown');
  assert.equal(view.label, 'Curfew');
  assert.equal(view.primary, '\u221250:00');

  const classified = classifyMilestones(
    [{ id: 'show-start', label: 'Show start', at: '20:00:00:00' }],
    23 * 3600 + 10 * 60,
  );
  assert.equal(classified.next, null);
  assert.equal(classified.overtime.label, 'Show start');
  const over = describeTimer({
    sample: { ...sample, hours: 23, minutes: 10, seconds: 0 },
    clientReceivedAt: nowMs,
    milestones: [{ id: 'show-start', label: 'Show start', at: '20:00:00:00' }],
    nowMs,
  });
  assert.equal(over.kind, 'overtime');
  assert.equal(over.primary, '+3:10:00');
});

const showNight = [
  { id: 'line', label: 'Line Check start', at: '08:00:00:00' },
  { id: 'sound', label: 'Sound Check start', at: '09:00:00:00' },
  { id: 'sound-end', label: 'Sound check end', at: '11:00:00:00' },
  { id: 'show', label: 'Show start', at: '23:00:00:00' },
  { id: 'curfew', label: 'Curfew', at: '02:00:00:00' },
];

function timerAt(hours, minutes, milestones) {
  const nowMs = 1;
  return describeTimer({
    sample: { source: 'clock', hours, minutes, seconds: 0, frames: 0, fps: null },
    clientReceivedAt: nowMs,
    milestones,
    mode: 'next',
    nowMs,
  });
}

test('a show that crosses midnight stays in list order', () => {
  const afternoon = timerAt(16, 51, showNight);
  assert.equal(afternoon.kind, 'countdown');
  assert.equal(afternoon.label, 'Show start');
  assert.equal(afternoon.primary, '\u22126:09:00');

  const beforeCurfew = timerAt(23, 30, showNight);
  assert.equal(beforeCurfew.label, 'Curfew');
  assert.equal(beforeCurfew.primary, '\u22122:30:00');

  const afterMidnight = timerAt(0, 30, showNight);
  assert.equal(afterMidnight.kind, 'countdown');
  assert.equal(afterMidnight.label, 'Curfew');
  assert.equal(afterMidnight.primary, '\u22121:30:00');

  const justAfter = timerAt(2, 30, showNight);
  assert.equal(justAfter.kind, 'overtime');
  assert.equal(justAfter.label, 'Curfew');
  assert.equal(justAfter.primary, '+30:00');

  const callTime = timerAt(7, 30, showNight);
  assert.equal(callTime.kind, 'countdown');
  assert.equal(callTime.label, 'Line Check start');
  assert.equal(callTime.primary, '\u221230:00');
});

test('a milestone already passed does not count down a full day after midnight', () => {
  const view = timerAt(1, 0, [{ id: 'show', label: 'Show start', at: '23:00:00:00' }]);
  assert.equal(view.kind, 'overtime');
  assert.equal(view.label, 'Show start');
  assert.equal(view.primary, '+2:00:00');

  const stillAhead = timerAt(1, 0, [
    { id: 'show', label: 'Show start', at: '23:00:00:00' },
    { id: 'curfew', label: 'Curfew', at: '02:00:00:00' },
  ]);
  assert.equal(stillAhead.kind, 'countdown');
  assert.equal(stillAhead.label, 'Curfew');
  assert.equal(stillAhead.primary, '\u22121:00:00');
});

test('tap modes show the milestone time or the clock', () => {
  const sample = { source: 'artnet', hours: 19, minutes: 0, seconds: 0, frames: 0, fps: 30 };
  const milestones = [{ id: 'curfew', label: 'Curfew', at: '23:00:00:00' }];
  const nowMs = 1000;
  const at = describeTimer({ sample, clientReceivedAt: nowMs, milestones, mode: 'at', nowMs });
  assert.equal(at.kind, 'at');
  assert.equal(at.primary, '23:00:00');
  assert.equal(at.source, 'TC');
  const face = describeTimer({
    sample, clientReceivedAt: nowMs, milestones, mode: 'clock', fallbackLabel: 'Show', nowMs,
  });
  assert.equal(face.primary, '19:00:00');
  assert.equal(face.label, 'Clock');
});

test('projectClock advances from receipt and wraps the day', () => {
  const projected = projectClock(
    { source: 'clock', hours: 23, minutes: 59, seconds: 58, frames: 0 },
    1_000,
    4_000,
  );
  assert.equal(projected.display, '00:00:01:00');
});

test('clock messages go to the set page and timer views', async () => {
  const bus = createBus();
  let timecode = { enabled: false, live: false, timecode: null };
  const config = {
    ...DEFAULTS,
    server: { httpPort: 0, wsHeartbeatSeconds: 0 },
    views: {
      band: { title: 'Band', fields: [{ column: 'Key' }] },
      lighting: {
        title: 'Lighting',
        fields: [{ column: 'Lasers' }, { type: 'timer', label: 'Show' }],
      },
      setlist: { title: 'Set', system: true },
      admin: { title: 'Admin', system: true },
    },
  };
  const server = await createViewServer({
    config,
    bus,
    log: silentLog,
    getHealthContext: () => ({ getTimecodeStatus: () => timecode }),
  });

  function open(view) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws?view=${view}`);
    const messages = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve({ ws, messages }));
      ws.once('error', reject);
    });
  }

  const band = await open('band');
  const lighting = await open('lighting');
  const setlist = await open('setlist');
  try {
    const bandInit = await waitFor(band.messages, (m) => m.type === 'init');
    const lightInit = await waitFor(lighting.messages, (m) => m.type === 'init');
    const setInit = await waitFor(setlist.messages, (m) => m.type === 'init');
    assert.equal(bandInit.clock, undefined);
    assert.equal(lightInit.clock.source, 'clock');
    assert.equal(setInit.clock.source, 'clock');

    timecode = {
      enabled: true,
      live: true,
      timecode: {
        display: '01:02:03:04',
        hours: 1,
        minutes: 2,
        seconds: 3,
        frames: 4,
        fps: 30,
        dropFrame: false,
        receivedAt: Date.now(),
      },
    };
    bus.emit(EVENTS.TIMECODE, timecode);
    const clock = await waitFor(lighting.messages, (m) => m.type === 'clock' && m.clock?.source === 'artnet');
    assert.equal(clock.clock.display, '01:02:03:04');
    assert.equal(band.messages.some((m) => m.type === 'clock'), false);
  } finally {
    band.ws.close();
    lighting.ws.close();
    setlist.ws.close();
    await server.stop();
  }
});

function waitFor(messages, predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const found = messages.find(predicate);
      if (found) return resolve(found);
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for message'));
      setTimeout(check, 20);
    };
    check();
  });
}
