// Touch-NUC kiosk chrome: Fullscreen + Reload + hold-to-Exit. Opt in with ?kiosk=1.

export const EXIT_HOLD_MS = 1500;
export const EXIT_HINT =
  'Couldn’t close the window. Press Alt+F4, or use the AbleView desktop shortcut.';
export const EXIT_HINT_NOT_APP =
  'Couldn’t close this window. Close every Edge window, then open AbleView from the desktop shortcut.';

const RELOAD_ICON = `<svg class="kiosk-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const EXIT_ICON = `<svg class="kiosk-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;
const FULLSCREEN_ICON = `<svg class="kiosk-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
const WINDOW_ICON = `<svg class="kiosk-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;

function currentSearch(search) {
  if (search != null) return search;
  if (typeof location !== 'undefined') return location.search;
  return '';
}

/** True for ?kiosk, ?kiosk=1, ?kiosk=true, ?kiosk=yes. */
export function isKioskMode(search) {
  const params = new URLSearchParams(currentSearch(search).replace(/^\?/, ''));
  if (!params.has('kiosk')) return false;
  const value = params.get('kiosk');
  if (value === '' || value == null) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/** Path + ?kiosk=1 when the current (or given) search is in kiosk mode. */
export function withKioskQuery(path, search) {
  const url = new URL(path, 'http://ableview.local');
  if (isKioskMode(search)) url.searchParams.set('kiosk', '1');
  else url.searchParams.delete('kiosk');
  return `${url.pathname}${url.search}`;
}

function defaultExitFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.fullscreenElement) return;
  return doc.exitFullscreen?.();
}

function defaultRequestFullscreen(doc) {
  const el = doc.documentElement;
  if (typeof el.requestFullscreen !== 'function') return;
  return Promise.resolve(el.requestFullscreen({ navigationUI: 'hide' }))
    .catch(() => el.requestFullscreen());
}

/** Hide Windows/Edge window chrome via the Fullscreen API (used with --app=). */
export function enterKioskFullscreen({
  doc = typeof document !== 'undefined' ? document : null,
  request,
} = {}) {
  if (!doc?.documentElement) return Promise.resolve(false);
  if (doc.fullscreenElement) return Promise.resolve(true);
  const req = request ?? (() => defaultRequestFullscreen(doc));
  return Promise.resolve(req())
    .then(() => true)
    .catch(() => false);
}

export function isDocumentFullscreen(doc = typeof document !== 'undefined' ? document : null) {
  return Boolean(doc?.fullscreenElement);
}

export function toggleKioskFullscreen({
  doc = typeof document !== 'undefined' ? document : null,
  request,
  exitFullscreen,
} = {}) {
  if (isDocumentFullscreen(doc)) {
    const leave = exitFullscreen ?? (() => defaultExitFullscreen(doc));
    return Promise.resolve(leave())
      .then(() => false)
      .catch(() => isDocumentFullscreen(doc));
  }
  return enterKioskFullscreen({ doc, request });
}

/** Edge --app= windows report standalone; a normal tab does not. */
export function isStandaloneAppWindow(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return false;
  try {
    return Boolean(
      win.matchMedia?.('(display-mode: standalone)').matches
      || win.matchMedia?.('(display-mode: minimal-ui)').matches
      || win.navigator?.standalone,
    );
  } catch {
    return false;
  }
}

export function exitHintForWindow(win = typeof window !== 'undefined' ? window : null) {
  return isStandaloneAppWindow(win) ? EXIT_HINT : EXIT_HINT_NOT_APP;
}

/**
 * Chromium only allows script close when the window was script-opened or the
 * session history has a single entry. Kiosk view switches must not pushState.
 * Settings is included: a real navigation exits the Fullscreen API.
 */
export function kioskLinkAction(nextId, {
  kiosk = false,
  statusOnly = false,
  fullscreen = false,
} = {}) {
  const interceptSpa = !statusOnly && Boolean(nextId) && (kiosk || fullscreen);
  if (interceptSpa) return kiosk ? 'spa-replace' : 'spa-push';
  if (kiosk) return 'replace';
  return 'follow';
}

/**
 * Fullscreen API exits on document unload, so Reload cannot use location.reload()
 * while fullscreen. Soft = same-document reconnect; hard = full page reload.
 */
export function kioskReloadAction({ fullscreen = false } = {}) {
  return fullscreen ? 'soft' : 'hard';
}

export function performKioskReload({
  fullscreen = false,
  reload,
  softReload,
} = {}) {
  const action = kioskReloadAction({ fullscreen });
  if (action === 'soft') {
    softReload?.();
    return action;
  }
  const reloadFn = reload ?? (() => location.reload());
  reloadFn();
  return action;
}

function defaultClose(win = typeof window !== 'undefined' ? window : null) {
  const target = win?.top ?? win;
  if (!target) return;
  try {
    // Claim this browsing context so Chromium treats it as script-closable.
    target.open('', '_self');
  } catch {
    // ignore
  }
  target.close();
}

export function closeKioskWindow({
  win = typeof window !== 'undefined' ? window : null,
  open,
  close,
} = {}) {
  const target = win?.top ?? win;
  if (open || close) {
    try {
      (open ?? ((url, name) => target?.open(url, name)))('', '_self');
    } catch {
      // ignore
    }
    (close ?? (() => target?.close()))();
    return;
  }
  defaultClose(win);
}

export function exitToDesktop({ close, exitFullscreen, win } = {}) {
  const closeFn = close ?? (() => closeKioskWindow({ win }));
  const leaveFs = exitFullscreen ?? (() => defaultExitFullscreen());
  return Promise.resolve()
    .then(() => leaveFs())
    .catch(() => {})
    .then(() => closeFn());
}

export function createHoldTracker({
  durationMs = EXIT_HOLD_MS,
  onProgress,
  onComplete,
  now = () => Date.now(),
} = {}) {
  let startedAt = 0;
  let active = false;

  return {
    start() {
      active = true;
      startedAt = now();
      onProgress?.(0);
    },
    update() {
      if (!active) return false;
      const progress = Math.min(1, (now() - startedAt) / durationMs);
      onProgress?.(progress);
      if (progress >= 1) {
        active = false;
        onComplete?.();
        return true;
      }
      return false;
    },
    cancel() {
      if (!active) return;
      active = false;
      onProgress?.(0);
    },
    get active() {
      return active;
    },
  };
}

function bindHold(button, onComplete) {
  const tracker = createHoldTracker({
    onProgress: (progress) => {
      button.style.setProperty('--hold', String(progress));
    },
    onComplete: () => {
      button.style.setProperty('--hold', '0');
      button.classList.remove('is-holding');
      onComplete();
    },
  });

  let raf = 0;
  let pointerId = null;

  function stopRaf() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function tick() {
    if (tracker.update()) {
      stopRaf();
      return;
    }
    raf = requestAnimationFrame(tick);
  }

  function releasePointer() {
    if (pointerId == null) return;
    try {
      button.releasePointerCapture(pointerId);
    } catch {
      // already released
    }
    pointerId = null;
  }

  function cancel() {
    stopRaf();
    tracker.cancel();
    button.classList.remove('is-holding');
    button.style.setProperty('--hold', '0');
    releasePointer();
  }

  button.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // capture is optional
    }
    button.classList.add('is-holding');
    tracker.start();
    tick();
  });
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

function showExitHint(host) {
  let hint = host.querySelector('.kiosk-exit-hint');
  if (!hint) {
    hint = document.createElement('span');
    hint.className = 'kiosk-exit-hint';
    hint.setAttribute('role', 'status');
    host.appendChild(hint);
  }
  hint.hidden = false;
  hint.textContent = exitHintForWindow();
}

function attemptExit(host, { close, afterCloseMs = 250 } = {}) {
  Promise.resolve(exitToDesktop({ close })).finally(() => {
    setTimeout(() => {
      showExitHint(host);
    }, afterCloseMs);
  });
}

function iconButton({ className, label, title, html }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = title;
  button.setAttribute('aria-label', label);
  button.innerHTML = `${html}<span class="kiosk-btn-label">${label}</span>`;
  return button;
}

function syncFullscreenButton(button, doc) {
  const on = isDocumentFullscreen(doc);
  const label = on ? 'Window' : 'Fullscreen';
  button.classList.toggle('kiosk-btn--fullscreen-on', on);
  button.title = on ? 'Show the Windows title bar' : 'Hide the Windows title bar';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', on ? 'true' : 'false');
  button.innerHTML = `${on ? WINDOW_ICON : FULLSCREEN_ICON}<span class="kiosk-btn-label">${label}</span>`;
}

function bindFullscreenButton(button, { doc, request, exitFullscreen } = {}) {
  const target = doc ?? document;
  syncFullscreenButton(button, target);
  button.addEventListener('click', () => {
    toggleKioskFullscreen({ doc: target, request, exitFullscreen }).finally(() => {
      syncFullscreenButton(button, target);
    });
  });
  target.addEventListener('fullscreenchange', () => {
    syncFullscreenButton(button, target);
  });
}

export function mountKioskControls({
  bar,
  search,
  reload,
  softReload,
  close,
  afterCloseMs = 250,
} = {}) {
  const statusBar = bar ?? (typeof document !== 'undefined' ? document.getElementById('status-bar') : null);
  if (typeof document !== 'undefined') {
    document.body?.classList.toggle('kiosk', isKioskMode(search));
  }
  if (!statusBar) return null;

  const existing = statusBar.querySelector('.kiosk-controls');
  if (!isKioskMode(search)) {
    existing?.remove();
    return null;
  }
  if (existing) return existing;

  const controls = document.createElement('div');
  controls.className = 'kiosk-controls';

  const fullscreenBtn = iconButton({
    className: 'kiosk-btn kiosk-btn--fullscreen',
    label: 'Fullscreen',
    title: 'Hide the Windows title bar',
    html: FULLSCREEN_ICON,
  });
  bindFullscreenButton(fullscreenBtn);
  controls.appendChild(fullscreenBtn);

  const reloadBtn = iconButton({
    className: 'kiosk-btn kiosk-btn--reload',
    label: 'Reload',
    title: 'Reload this page',
    html: RELOAD_ICON,
  });
  reloadBtn.addEventListener('click', () => {
    performKioskReload({
      fullscreen: isDocumentFullscreen(),
      reload,
      softReload,
    });
  });
  controls.appendChild(reloadBtn);

  const exitBtn = iconButton({
    className: 'kiosk-btn kiosk-btn--exit',
    label: 'Exit',
    title: 'Hold to leave AbleView and show Windows',
    html: EXIT_ICON,
  });
  bindHold(exitBtn, () => attemptExit(controls, { close, afterCloseMs }));
  controls.appendChild(exitBtn);

  statusBar.appendChild(controls);
  return controls;
}
