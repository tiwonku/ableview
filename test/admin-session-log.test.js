import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSessionNameInputValue } from '../public/shared/admin-session-log.js';

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
