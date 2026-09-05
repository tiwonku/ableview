import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('setlist view is wired in HTML, render, and ws-client', () => {
  const html = readFileSync(
    fileURLToPath(new URL('../public/views/setlist.html', import.meta.url)),
    'utf8',
  );
  const settingsHtml = readFileSync(
    fileURLToPath(new URL('../public/views/settings.html', import.meta.url)),
    'utf8',
  );
  const renderSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/setlist-render.js', import.meta.url)),
    'utf8',
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  assert.match(html, /AbleView — Set/);
  assert.match(html, /viewId: 'setlist'/);
  assert.match(html, /id="session-log"/);
  assert.doesNotMatch(settingsHtml, /id="session-log"/);
  assert.match(renderSrc, /title \|\| 'Set'/);
  assert.match(renderSrc, /Pin only when you want this row on the live board/);
  assert.match(renderSrc, /Clear pin/);
  assert.match(renderSrc, /Delete set/);
  assert.match(renderSrc, /onDelete/);
  assert.match(renderSrc, /getMomentWho/);
  assert.match(renderSrc, /prependDopeButton/);
  const sessionLogSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/admin-session-log.js', import.meta.url)),
    'utf8',
  );
  assert.match(sessionLogSrc, /mountSetNoteRow/);
  assert.match(clientSrc, /currentViewId === 'setlist'/);
  assert.match(clientSrc, /renderSetlist/);
  assert.match(clientSrc, /syncSessionLogPanel/);
  assert.match(clientSrc, /\/api\/setlist/);
  assert.match(clientSrc, /body: \{ delete: true \}/);
  assert.match(clientSrc, /function setlistCueChanged/);
  assert.match(clientSrc, /mergePinResults/);
});
