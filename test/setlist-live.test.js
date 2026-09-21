import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  liveBoardModel,
  setHealthChips,
  setNavModel,
  formatSetConfidence,
  formatSyncedAge,
  itemDisplayKey,
  buildQuickCueChanges,
  peekSwatches,
} from '../public/shared/setlist-render.js';

const setlist = {
  items: [
    { rowId: '12', title: 'Hot Rox', status: 'confirmed', key: 'Ebm' },
    { rowId: '7', title: 'Breeze', status: 'likely', key: 'Dm' },
  ],
};

test('formatSetConfidence and formatSyncedAge', () => {
  assert.equal(formatSetConfidence(0.94), '94%');
  assert.equal(formatSetConfidence(null), null);
  const now = Date.parse('2026-09-05T18:20:00.000Z');
  assert.equal(formatSyncedAge('2026-09-05T18:18:00.000Z', now), '2m');
  assert.equal(formatSyncedAge('2026-09-05T18:19:40.000Z', now), '20s');
  assert.equal(formatSyncedAge(null, now), null);
});

test('liveBoardModel waiting and no-match', () => {
  const idle = liveBoardModel(null, { setlist });
  assert.equal(idle.tone, 'idle');
  assert.equal(idle.eyebrow, 'WAITING');

  const nomatch = liveBoardModel({
    clipName: 'Hot Rox_DRUMS',
    match: { matched: false },
    lastMatched: { title: 'Song A', rowId: '3' },
  }, { setlist });
  assert.equal(nomatch.tone, 'nomatch');
  assert.equal(nomatch.eyebrow, 'NO MATCH');
  assert.equal(nomatch.title, 'Hot Rox_DRUMS');
  assert.match(nomatch.meta, /Hot Rox_DRUMS/);
  assert.equal(nomatch.last, 'Last: Song A');
  assert.equal(nomatch.onSet, false);
  assert.deepEqual(idle.nextColors, []);
  assert.deepEqual(nomatch.nextColors, []);
});

test('liveBoardModel matched on-set includes next and confidence', () => {
  const live = liveBoardModel({
    clipName: 'Hot Rox',
    match: { matched: true, rowId: '12', confidence: 0.94, matchedValue: 'Hot Rox' },
    row: { 'Song Title': 'Hot Rox' },
  }, { matchColumn: 'Song Title', setlist });
  assert.equal(live.tone, 'live');
  assert.equal(live.eyebrow, 'LIVE');
  assert.equal(live.title, 'Hot Rox');
  assert.match(live.meta, /94%/);
  assert.match(live.meta, /on set · #1/);
  assert.equal(live.next, 'Next · Breeze · Dm');
  assert.equal(live.nextTitle, 'Breeze');
  assert.deepEqual(live.nextColors, []);
  assert.equal(live.onSet, true);
});

test('liveBoardModel carries the next song colors for a peek', () => {
  const withColors = {
    items: [
      {
        rowId: '12',
        title: 'Hot Rox',
        key: 'Ebm',
        colors: [{ column: 'RGB_1', label: 'Color 1', value: '1, 2, 3' }],
      },
      {
        rowId: '7',
        title: 'Breeze',
        key: 'Dm',
        colors: [
          { column: 'RGB_1', label: 'Color 1', value: '9, 8, 7' },
          { column: 'RGB_2', label: 'Color 2', value: 'nope' },
          { column: 'RGB_3', label: 'Color 3', value: 'RAINBOW' },
        ],
      },
    ],
  };
  const live = liveBoardModel({
    clipName: 'Hot Rox',
    match: { matched: true, rowId: '12', confidence: 1, matchedValue: 'Hot Rox' },
  }, { setlist: withColors });
  assert.equal(live.nextTitle, 'Breeze');
  assert.equal(live.nextColors.length, 3);
  const swatches = peekSwatches(live.nextColors);
  assert.equal(swatches.length, 2);
  assert.equal(swatches[0].label, 'Color 1');
  assert.equal(swatches[0].color.rgbText, '9, 8, 7');
  assert.equal(swatches[1].color.kind, 'rainbow');
  assert.equal(peekSwatches(null).length, 0);
  assert.equal(peekSwatches([{ value: '' }]).length, 0);
});

test('liveBoardModel pinned and not-on-set', () => {
  const pinned = liveBoardModel({
    clipName: 'Other Clip',
    match: {
      matched: true,
      rowId: '99',
      confidence: 1,
      matchedValue: 'Deep Cut',
      viaOverride: true,
    },
    row: { 'Song Title': 'Deep Cut' },
  }, { matchColumn: 'Song Title', setlist });
  assert.equal(pinned.tone, 'pinned');
  assert.equal(pinned.eyebrow, 'PINNED');
  assert.equal(pinned.title, 'Deep Cut');
  assert.match(pinned.meta, /Clip “Other Clip”/);
  assert.match(pinned.meta, /Pinned/);
  assert.match(pinned.meta, /Not on tonight/);
  assert.equal(pinned.next, '');
  assert.deepEqual(pinned.nextColors, []);
});

test('setHealthChips flags Ableton, stale sheet, no match, and other views', () => {
  const chips = setHealthChips(
    {
      stale: true,
      syncedAt: '2026-09-05T18:18:00.000Z',
      ingestLive: false,
      clipName: 'X',
      match: { matched: false },
    },
    {
      connectedViews: 1,
      ingest: { live: false, cueTrackConfigured: 'Cue', cueTrackFound: false },
    },
    { simulated: false },
  );
  const byId = Object.fromEntries(chips.map((c) => [c.id, c]));
  assert.equal(byId.ableton.warn, true);
  assert.equal(byId.sheet.warn, true);
  assert.match(byId.sheet.label, /stale/i);
  assert.equal(byId.match.warn, true);
  assert.equal(byId.views.warn, true);
  assert.equal(byId.views.label, 'No other views');
  assert.equal(byId['cue-track'].warn, true);
});

test('setHealthChips skips Ableton and cue-track in sim', () => {
  const chips = setHealthChips(
    { simulated: true, stale: false, match: { matched: true } },
    { connectedViews: 3 },
    { simulated: true },
  );
  assert.equal(chips.some((c) => c.id === 'ableton'), false);
  assert.equal(chips.some((c) => c.id === 'cue-track'), false);
  assert.equal(chips.find((c) => c.id === 'views')?.label, '2 other views');
  assert.equal(chips.find((c) => c.id === 'sheet')?.action, 'sync');
});

test('setNavModel marks current, pinned, and pin-able rows', () => {
  const model = setNavModel(
    {
      match: { matched: true, rowId: '12', viaOverride: true },
    },
    {
      name: 'festival',
      library: [{ name: 'festival', itemCount: 2 }],
      items: [
        { rowId: '12', title: 'Hot Rox', status: 'confirmed', key: 'Ebm' },
        { rowId: '7', title: 'Breeze', status: 'likely' },
        { rowId: '3', title: 'Ghost', missing: true },
      ],
    },
  );
  assert.equal(model.name, 'festival');
  assert.equal(model.items[0].current, true);
  assert.equal(model.items[0].pinned, true);
  assert.equal(model.items[0].key, 'Ebm');
  assert.equal(model.items[0].canPin, false);
  assert.equal(model.items[1].current, false);
  assert.equal(model.items[1].canPin, true);
  assert.equal(model.items[2].canPin, false);
  assert.equal(model.items[2].missing, true);
});

test('itemDisplayKey and buildQuickCueChanges keep the create form to title + key', () => {
  assert.equal(itemDisplayKey({ key: 'F#' }), 'F#');
  assert.equal(itemDisplayKey({ title: 'Song A' }), '');
  assert.deepEqual(
    buildQuickCueChanges({ title: 'Sunshine', key: 'Am', matchColumn: 'Song Title' }),
    { 'Song Title': 'Sunshine', Key: 'Am' },
  );
  assert.deepEqual(
    buildQuickCueChanges({ title: '  ', key: 'Am', matchColumn: 'Song Title' }),
    { Key: 'Am' },
  );
});

test('setNavModel has no current row when unmatched', () => {
  const model = setNavModel(
    { match: { matched: false } },
    { name: 'club', items: [{ rowId: '1', title: 'Intro' }] },
  );
  assert.equal(model.items[0].current, false);
  assert.equal(model.items[0].pinned, false);
  assert.equal(model.items[0].canPin, true);
});
