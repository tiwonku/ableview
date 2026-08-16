import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXIT_HOLD_MS,
  EXIT_HINT,
  isKioskMode,
  withKioskQuery,
  exitToDesktop,
  enterKioskFullscreen,
  toggleKioskFullscreen,
  isDocumentFullscreen,
  createHoldTracker,
} from '../public/shared/kiosk-controls.js';

test('isKioskMode accepts kiosk query values', () => {
  assert.equal(isKioskMode(''), false);
  assert.equal(isKioskMode('?foo=1'), false);
  assert.equal(isKioskMode('?kiosk=0'), false);
  assert.equal(isKioskMode('?kiosk=false'), false);
  assert.equal(isKioskMode('?kiosk'), true);
  assert.equal(isKioskMode('?kiosk=1'), true);
  assert.equal(isKioskMode('?kiosk=true'), true);
  assert.equal(isKioskMode('?kiosk=yes'), true);
  assert.equal(isKioskMode('?view=band&kiosk=1'), true);
});

test('withKioskQuery preserves or strips the kiosk flag', () => {
  assert.equal(withKioskQuery('/views/band', ''), '/views/band');
  assert.equal(withKioskQuery('/views/visuals', '?kiosk=1'), '/views/visuals?kiosk=1');
  assert.equal(withKioskQuery('/views/settings', '?kiosk'), '/views/settings?kiosk=1');
  assert.equal(withKioskQuery('/views/band?x=1', '?kiosk=1'), '/views/band?x=1&kiosk=1');
});

test('exitToDesktop exits fullscreen then closes', async () => {
  const order = [];
  await exitToDesktop({
    exitFullscreen: () => { order.push('fs'); },
    close: () => { order.push('close'); },
  });
  assert.deepEqual(order, ['fs', 'close']);
});

test('enterKioskFullscreen requests fullscreen when not active', async () => {
  let requested = 0;
  const doc = { fullscreenElement: null, documentElement: {} };
  const ok = await enterKioskFullscreen({
    doc,
    request: () => { requested += 1; },
  });
  assert.equal(ok, true);
  assert.equal(requested, 1);
});

test('enterKioskFullscreen skips when already fullscreen', async () => {
  let requested = 0;
  await enterKioskFullscreen({
    doc: { fullscreenElement: {}, documentElement: {} },
    request: () => { requested += 1; },
  });
  assert.equal(requested, 0);
});

test('isDocumentFullscreen follows fullscreenElement', () => {
  assert.equal(isDocumentFullscreen({ fullscreenElement: null }), false);
  assert.equal(isDocumentFullscreen({ fullscreenElement: {} }), true);
});

test('toggleKioskFullscreen enters when windowed and leaves when fullscreen', async () => {
  let requested = 0;
  let exited = 0;
  const windowed = { fullscreenElement: null, documentElement: {} };
  assert.equal(await toggleKioskFullscreen({
    doc: windowed,
    request: () => { requested += 1; },
  }), true);
  assert.equal(requested, 1);

  const full = { fullscreenElement: {} };
  assert.equal(await toggleKioskFullscreen({
    doc: full,
    exitFullscreen: () => { exited += 1; },
  }), false);
  assert.equal(exited, 1);
});

test('createHoldTracker completes after duration and cancels mid-hold', () => {
  let now = 0;
  let progress = null;
  let completed = 0;
  const tracker = createHoldTracker({
    durationMs: EXIT_HOLD_MS,
    now: () => now,
    onProgress: (value) => { progress = value; },
    onComplete: () => { completed += 1; },
  });

  tracker.start();
  now = EXIT_HOLD_MS / 2;
  assert.equal(tracker.update(), false);
  assert.equal(progress, 0.5);
  assert.equal(completed, 0);

  tracker.cancel();
  assert.equal(progress, 0);
  assert.equal(tracker.active, false);

  now = 0;
  tracker.start();
  now = EXIT_HOLD_MS;
  assert.equal(tracker.update(), true);
  assert.equal(completed, 1);
  assert.equal(tracker.active, false);
});

test('exit hint copy is operator-facing', () => {
  assert.match(EXIT_HINT, /Alt\+F4/);
});
