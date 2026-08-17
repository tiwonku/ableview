import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OSC_READ_ALLOWLIST, isReadOnlyAddress, assertReadOnlyAddress } from '../src/ingest/osc-addresses.js';

// NFR-1: the tool MUST NOT emit any AbletonOSC write address.

const WRITE_ADDRESS_RE = /\/(set|fire|create_\w+|delete_\w+|start_playing|stop_playing|continue_playing)(\/|$)/;

test('allowlist contains no write addresses', () => {
  for (const address of OSC_READ_ALLOWLIST) {
    assert.ok(!WRITE_ADDRESS_RE.test(address), `write address in allowlist: ${address}`);
    assert.ok(
      /\/(get|start_listen|stop_listen)\//.test(address) || address === '/live/test',
      `address is not read/listen shaped: ${address}`
    );
  }
});

test('known write addresses are rejected', () => {
  const writes = [
    '/live/song/set/tempo',
    '/live/clip/fire',
    '/live/clip_slot/fire',
    '/live/song/create_scene',
    '/live/song/delete_track',
    '/live/song/start_playing',
    '/live/song/stop_playing',
    '/live/track/set/mute',
    '/live/clip/set/name',
  ];
  for (const address of writes) {
    assert.equal(isReadOnlyAddress(address), false, `should reject: ${address}`);
    assert.throws(() => assertReadOnlyAddress(address), /NFR-1/);
  }
});

test('non-allowlisted read addresses are also rejected (strict allowlist)', () => {
  assert.equal(isReadOnlyAddress('/live/song/get/some_future_thing'), false);
});

test('all addresses used by the abletonosc adapter are allowlisted', () => {
  // Structural check: every string literal passed to send() in the adapter
  // source must be on the allowlist. There is no other way to emit OSC.
  const source = readFileSync(new URL('../src/ingest/sources/abletonosc.js', import.meta.url), 'utf8');
  const sent = [...source.matchAll(/send\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.ok(sent.length > 0, 'expected send() calls in adapter');
  for (const address of sent) {
    assert.ok(isReadOnlyAddress(address), `adapter sends non-allowlisted address: ${address}`);
  }
});

test('clock OSC output never uses Ableton /live addresses', () => {
  const source = readFileSync(new URL('../src/outputs/osc.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]\/live\//);
  assert.doesNotMatch(source, /assertReadOnlyAddress/);
  assert.match(source, /\/ableview\/clock\/tempo/);
  assert.match(source, /\/ableview\/clock\/beat/);
  assert.match(source, /\/ableview\/clock\/bar/);
  assert.match(source, /\/ableview\/clock\/is_playing/);
  assert.match(source, /\/ableview\/clock\/signature/);
});
