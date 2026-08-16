// In-document settings + session-log mount so kiosk/fullscreen can open
// Settings without a navigation (Fullscreen API exits on document load).

import { mountSettingsPanel } from './admin-settings.js';
import { mountSessionLogPanel } from './admin-session-log.js';

function resolveEl(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    return typeof document !== 'undefined' ? document.querySelector(target) : null;
  }
  return target;
}

export function ensureSessionLogHost(app) {
  const doc = app?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  let host = doc?.getElementById('session-log');
  if (host) return { host, created: false };
  if (!app || !doc) return { host: null, created: false };
  host = doc.createElement('section');
  host.id = 'session-log';
  host.className = 'settings-main session-log-main';
  host.setAttribute('aria-label', 'Session log');
  app.insertAdjacentElement('afterend', host);
  return { host, created: true };
}

/** Mount settings + session log into the current document. Returns unmount. */
export function attachSettingsOverlay(appTarget) {
  const app = resolveEl(appTarget);
  if (!app) return () => {};

  const { host, created } = ensureSessionLogHost(app);
  if (host) host.hidden = false;
  app.replaceChildren();

  const unmountSettings = mountSettingsPanel(app);
  const unmountSession = host ? mountSessionLogPanel(host) : null;

  return () => {
    unmountSettings?.();
    unmountSession?.();
    if (!host) return;
    if (created) host.remove();
    else {
      host.replaceChildren();
      host.hidden = true;
    }
  };
}
