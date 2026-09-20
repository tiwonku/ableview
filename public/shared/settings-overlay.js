// In-document settings mount so kiosk/fullscreen can open
// Settings without a navigation (Fullscreen API exits on document load).

import { mountSettingsPanel } from './admin-settings.js';

function resolveEl(target) {
  if (!target) return null;
  if (typeof target === 'string') {
    return typeof document !== 'undefined' ? document.querySelector(target) : null;
  }
  return target;
}

/** Mount settings into the current document. Returns unmount. */
export function attachSettingsOverlay(appTarget) {
  const app = resolveEl(appTarget);
  if (!app) {
    return { unmount() {}, applyLiveColors() {} };
  }

  app.replaceChildren();
  const panel = mountSettingsPanel(app);

  return {
    unmount: () => {
      panel?.unmount?.();
    },
    applyLiveColors: (status) => {
      panel?.applyLiveColors?.(status);
    },
  };
}
