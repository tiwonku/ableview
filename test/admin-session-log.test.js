import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSessionLogHost,
  formatSessionLogStatusLine,
  nextSessionNameInputValue,
} from '../public/shared/admin-session-log.js';

test('session name field follows the server until the operator starts a draft', () => {
  assert.equal(nextSessionNameInputValue({
    serverName: 'test',
    inputValue: '',
    lastCommittedName: null,
  }), 'test');

  assert.equal(nextSessionNameInputValue({
    serverName: 'test',
    inputValue: 'test',
    lastCommittedName: 'test',
  }), 'test');

  assert.equal(nextSessionNameInputValue({
    serverName: '2026-08-21_211504',
    inputValue: 'test',
    lastCommittedName: 'test',
  }), '2026-08-21_211504');
});

test('session name field keeps a typed draft across status refreshes', () => {
  assert.equal(nextSessionNameInputValue({
    serverName: 'test',
    inputValue: 'show-night',
    lastCommittedName: 'test',
  }), 'show-night');
});

test('applying a session name always shows the sanitized server value', () => {
  assert.equal(nextSessionNameInputValue({
    serverName: 'show-night',
    inputValue: 'show night',
    lastCommittedName: 'test',
    always: true,
  }), 'show-night');
});

test('formatSessionLogStatusLine is a compact one-liner', () => {
  assert.equal(formatSessionLogStatusLine({ enabled: false }), 'Logging off');
  assert.equal(
    formatSessionLogStatusLine({ enabled: false, sessionName: 'rehearsal' }),
    'Logging off · rehearsal.jsonl',
  );
  assert.equal(
    formatSessionLogStatusLine({
      enabled: true,
      sessionName: 'show-night',
      lineCount: 1,
      momentCount: 1,
    }),
    'show-night.jsonl · 1 line · 1 moment',
  );
  assert.equal(
    formatSessionLogStatusLine({
      enabled: true,
      sessionName: 'show-night',
      lineCount: 42,
      momentCount: 3,
    }),
    'show-night.jsonl · 42 lines · 3 moments',
  );
  assert.equal(
    formatSessionLogStatusLine({
      enabled: true,
      sessionName: 'show-night',
      lineCount: 42,
      momentCount: 3,
      lastMoment: { who: 'keys' },
    }),
    'show-night.jsonl · 42 lines · 3 moments · keys',
  );
});

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

test('ensureSessionLogHost creates a compact set-log section above the app', () => {
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
  assert.equal(created.className, 'set-log');
  assert.equal(created.attrs['aria-label'], 'Session log');
  assert.deepEqual(inserted, [['beforebegin', created]]);
});
