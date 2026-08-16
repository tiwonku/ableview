import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewIdFromPath } from '../public/shared/view-nav.js';

test('viewIdFromPath reads /views/:id', () => {
  assert.equal(viewIdFromPath('/views/band'), 'band');
  assert.equal(viewIdFromPath('/views/visuals'), 'visuals');
  assert.equal(viewIdFromPath('/views/settings'), 'settings');
  assert.equal(viewIdFromPath('/views/band/'), 'band');
  assert.equal(viewIdFromPath('/health'), null);
  assert.equal(viewIdFromPath('/'), null);
});
