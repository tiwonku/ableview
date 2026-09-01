import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePinResults, pinResultsFromSetlist } from '../public/shared/pin-panel.js';

const setlist = {
  name: 'festival-saturday',
  items: [
    { rowId: '11', title: 'Almost Familiar', status: 'confirmed' },
    { rowId: '55', title: 'Finally Moving', status: 'likely', liveTitle: 'Finally Moving (live)' },
    { rowId: '125', title: 'Road To The Stars', status: 'maybe', missing: true },
    { rowId: '7', title: 'After Midnight', status: 'confirmed' },
  ],
};

test('pinResultsFromSetlist keeps show order and skips missing sheet rows', () => {
  const results = pinResultsFromSetlist(setlist);
  assert.deepEqual(results.map((r) => r.rowId), ['11', '55', '7']);
  assert.equal(results[1].title, 'Finally Moving (live)');
  assert.equal(results.every((r) => r.fromSetlist), true);
});

test('empty pin query shows the setlist, not the cue sheet', () => {
  const { results, source } = mergePinResults({
    query: '',
    setlist,
    sheetResults: [
      { rowId: '6', title: 'A Million Tomorrows' },
      { rowId: '7', title: 'After Midnight' },
    ],
  });
  assert.equal(source, 'setlist');
  assert.deepEqual(results.map((r) => r.rowId), ['11', '55', '7']);
});

test('pin search keeps matching setlist rows first, then other sheet hits', () => {
  const { results, source } = mergePinResults({
    query: 'mid',
    setlist,
    sheetResults: [
      { rowId: '6', title: 'A Million Tomorrows', secondary: [{ column: 'ALS Folder', value: 'Abm_79bpm' }] },
      { rowId: '7', title: 'After Midnight', secondary: [{ column: 'ALS Folder', value: 'Dm_95bpm_AfterMidnight_24' }] },
      { rowId: '88', title: 'Midnight Oil' },
    ],
  });
  assert.equal(source, 'sheet');
  assert.deepEqual(results.map((r) => r.rowId), ['7', '6', '88']);
  assert.equal(results[0].fromSetlist, true);
  assert.equal(results[0].secondary[0].value, 'Dm_95bpm_AfterMidnight_24');
  assert.equal(results[1].fromSetlist, false);
});

test('pin search can find a sheet row that is not on the setlist', () => {
  const { results } = mergePinResults({
    query: 'Million',
    setlist,
    sheetResults: [{ rowId: '6', title: 'A Million Tomorrows' }],
  });
  assert.deepEqual(results.map((r) => r.rowId), ['6']);
  assert.equal(results[0].fromSetlist, false);
});

test('ALS folder hits on a setlist row still sort with the setlist', () => {
  const { results } = mergePinResults({
    query: 'HotRox',
    setlist: {
      items: [{ rowId: '70', title: 'Hot Like Rox' }],
    },
    sheetResults: [{
      rowId: '70',
      title: 'Hot Like Rox',
      secondary: [{ column: 'ALS Folder', value: 'Ebm_80bpm_HotRox_24' }],
    }],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].fromSetlist, true);
  assert.equal(results[0].secondary[0].value, 'Ebm_80bpm_HotRox_24');
});
