import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('setlist view is wired in HTML, render, and ws-client', () => {
  const html = readFileSync(
    fileURLToPath(new URL('../public/views/setlist.html', import.meta.url)),
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
  assert.match(html, /viewId: 'setlist'/);
  assert.match(renderSrc, /Pin only when you want this row on the live board/);
  assert.match(renderSrc, /Clear pin/);
  assert.match(clientSrc, /currentViewId === 'setlist'/);
  assert.match(clientSrc, /renderSetlist/);
  assert.match(clientSrc, /\/api\/setlist/);
  assert.match(clientSrc, /function setlistCueChanged/);
});
