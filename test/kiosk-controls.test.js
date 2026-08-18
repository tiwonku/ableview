import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXIT_HOLD_MS,
  EXIT_HINT,
  EXIT_HINT_NOT_APP,
  isKioskMode,
  withKioskQuery,
  exitToDesktop,
  enterKioskFullscreen,
  armKioskAutoFullscreen,
  toggleKioskFullscreen,
  isDocumentFullscreen,
  createHoldTracker,
  closeKioskWindow,
  kioskLinkAction,
  kioskReloadAction,
  performKioskReload,
  isStandaloneAppWindow,
  exitHintForWindow,
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

test('armKioskAutoFullscreen skips when already fullscreen', () => {
  let requested = 0;
  let added = 0;
  armKioskAutoFullscreen({
    doc: { fullscreenElement: {}, documentElement: {} },
    target: { addEventListener() { added += 1; } },
    enter: () => { requested += 1; return Promise.resolve(true); },
  });
  assert.equal(requested, 0);
  assert.equal(added, 0);
});

test('armKioskAutoFullscreen requests fullscreen then retries on pointerdown', async () => {
  let requested = 0;
  const listeners = {};
  const doc = {
    fullscreenElement: null,
    documentElement: {},
    addEventListener() {},
    removeEventListener() {},
  };
  const target = {
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
  armKioskAutoFullscreen({
    doc,
    target,
    enter: () => {
      requested += 1;
      return Promise.resolve(false);
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(requested, 1);
  assert.equal(typeof listeners.pointerdown, 'function');
  listeners.pointerdown();
  assert.equal(requested, 2);
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
  assert.match(EXIT_HINT_NOT_APP, /desktop shortcut/);
});

test('kioskLinkAction keeps kiosk history from growing', () => {
  assert.equal(kioskLinkAction('visuals', { kiosk: true }), 'spa-replace');
  assert.equal(kioskLinkAction('settings', { kiosk: true }), 'spa-replace');
  assert.equal(kioskLinkAction('band', { kiosk: true, statusOnly: true }), 'replace');
  assert.equal(kioskLinkAction('visuals', { fullscreen: true }), 'spa-push');
  assert.equal(kioskLinkAction('settings', { fullscreen: true }), 'spa-push');
  assert.equal(kioskLinkAction('visuals', {}), 'follow');
  assert.equal(kioskLinkAction('settings', {}), 'follow');
});

test('kioskReloadAction stays in-document while fullscreen', () => {
  assert.equal(kioskReloadAction({ fullscreen: true }), 'soft');
  assert.equal(kioskReloadAction({ fullscreen: false }), 'hard');
  assert.equal(kioskReloadAction({}), 'hard');
});

test('performKioskReload does not hard-reload while fullscreen', () => {
  let soft = 0;
  let hard = 0;
  assert.equal(performKioskReload({
    fullscreen: true,
    softReload: () => { soft += 1; },
    reload: () => { hard += 1; },
  }), 'soft');
  assert.equal(soft, 1);
  assert.equal(hard, 0);

  assert.equal(performKioskReload({
    fullscreen: false,
    softReload: () => { soft += 1; },
    reload: () => { hard += 1; },
  }), 'hard');
  assert.equal(soft, 1);
  assert.equal(hard, 1);
});

test('closeKioskWindow claims the window then closes', () => {
  const calls = [];
  const win = {
    top: null,
    open(url, target) { calls.push(['open', url, target]); },
    close() { calls.push(['close']); },
  };
  win.top = win;
  closeKioskWindow({
    win,
    open: (url, target) => win.open(url, target),
    close: () => win.close(),
  });
  assert.deepEqual(calls, [['open', '', '_self'], ['close']]);
});

test('isStandaloneAppWindow and exit hint follow display-mode', () => {
  const standalone = {
    matchMedia: (query) => ({ matches: query.includes('standalone') }),
  };
  const browser = {
    matchMedia: () => ({ matches: false }),
  };
  assert.equal(isStandaloneAppWindow(standalone), true);
  assert.equal(isStandaloneAppWindow(browser), false);
  assert.equal(exitHintForWindow(standalone), EXIT_HINT);
  assert.equal(exitHintForWindow(browser), EXIT_HINT_NOT_APP);
});
