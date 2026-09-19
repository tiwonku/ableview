import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { attachSettingsOverlay } from '../public/shared/settings-overlay.js';

test('settings overlay no longer mounts the session log', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../public/shared/settings-overlay.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /mountSettingsPanel/);
  assert.doesNotMatch(src, /mountSessionLogPanel/);
  assert.doesNotMatch(src, /ensureSessionLogHost/);
  assert.doesNotMatch(src, /session-log/);
});

test('attachSettingsOverlay is a no-op without an app root', () => {
  const unmount = attachSettingsOverlay(null);
  assert.equal(typeof unmount, 'function');
  unmount();
});

test('settings panel includes operator LAN share links', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../public/shared/admin-settings.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /Operator links/);
  assert.match(src, /shareFromNetResponse/);
  assert.match(src, /copyTextToClipboard/);
  assert.match(src, /\/api\/net\/interfaces/);
});

test('settings panel can toggle arrangement matching', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../public/shared/admin-settings.js', import.meta.url)),
    'utf8',
  );
  assert.match(src, /includeArrangement/);
  assert.match(src, /Match Arrangement-view clips/);
});
