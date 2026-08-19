import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aliasFromTokenPrefix,
  aliasWouldMatchClip,
  suggestAliasStem,
  tokenizeClipName,
} from '../public/shared/alias-stem.js';

test('suggestAliasStem takes text before underscore', () => {
  assert.equal(suggestAliasStem('HotRox_ DRUMS'), 'HotRox');
  assert.equal(suggestAliasStem('HotRox_ SAMPLES'), 'HotRox');
});

test('suggestAliasStem strips trailing role words', () => {
  assert.equal(suggestAliasStem('Hot Rox DRUMS'), 'Hot Rox');
});

test('tokenizeClipName keeps delimiters', () => {
  const tokens = tokenizeClipName('HotRox_ DRUMS');
  assert.deepEqual(
    tokens.map((t) => [t.text, t.selectable]),
    [
      ['HotRox', true],
      ['_', false],
      [' ', false],
      ['DRUMS', true],
    ]
  );
});

test('aliasFromTokenPrefix builds stem or full clip', () => {
  const tokens = tokenizeClipName('HotRox_ DRUMS');
  assert.equal(aliasFromTokenPrefix(tokens, 0), 'HotRox');
  assert.equal(aliasFromTokenPrefix(tokens, 3), 'HotRox_ DRUMS');
});

test('aliasWouldMatchClip uses prefix rule after normalize', () => {
  assert.equal(aliasWouldMatchClip('HotRox', 'HotRox_ DRUMS'), true);
  assert.equal(aliasWouldMatchClip('HotRox', 'HotRox_ SAMPLES'), true);
  assert.equal(aliasWouldMatchClip('Hot Like Rox', 'HotRox_ DRUMS'), false);
  assert.equal(aliasWouldMatchClip('TTY', 'TTY VOX/STRINGS*'), true);
  assert.equal(aliasWouldMatchClip('TTY', 'TTY 2TRK DROP'), true);
});

test('aliasWouldMatchClip matches a whole-word stem mid-clip', () => {
  assert.equal(
    aliasWouldMatchClip('TTT', 'Vocals TTT INTRO VOCAL [2026-08-09 155900]'),
    true
  );
  assert.equal(aliasWouldMatchClip('TT', 'Vocals TTT INTRO VOCAL'), false);
});
