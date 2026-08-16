import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureSessionLogHost } from '../public/shared/settings-overlay.js';

test('ensureSessionLogHost reuses an existing session-log node', () => {
  const existing = { id: 'session-log' };
  const app = {
    ownerDocument: {
      getElementById: (id) => (id === 'session-log' ? existing : null),
    },
  };
  const result = ensureSessionLogHost(app);
  assert.equal(result.host, existing);
  assert.equal(result.created, false);
});

test('ensureSessionLogHost creates a session-log section when missing', () => {
  const inserted = [];
  const created = { id: null, className: '', attrs: {} };
  const doc = {
    getElementById: () => null,
    createElement: (tag) => {
      assert.equal(tag, 'section');
      return created;
    },
  };
  const app = {
    ownerDocument: doc,
    insertAdjacentElement: (where, node) => {
      inserted.push([where, node]);
    },
  };
  created.setAttribute = (name, value) => {
    created.attrs[name] = value;
  };

  const result = ensureSessionLogHost(app);
  assert.equal(result.created, true);
  assert.equal(result.host, created);
  assert.equal(created.id, 'session-log');
  assert.equal(created.className, 'settings-main session-log-main');
  assert.equal(created.attrs['aria-label'], 'Session log');
  assert.deepEqual(inserted, [['afterend', created]]);
});
