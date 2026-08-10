import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAliasValue, assertAliasColumnPresent } from '../src/sheets/aliases.js';
import { searchSheetRows } from '../src/sheets/search-rows.js';

test('mergeAliasValue appends pipe-separated aliases', () => {
  assert.deepEqual(mergeAliasValue('', 'HotRox'), {
    value: 'HotRox',
    added: true,
    aliases: ['HotRox'],
  });
  assert.deepEqual(mergeAliasValue('SA Intro', 'HotRox'), {
    value: 'SA Intro|HotRox',
    added: true,
    aliases: ['SA Intro', 'HotRox'],
  });
});

test('mergeAliasValue is case-insensitive dedupe', () => {
  const result = mergeAliasValue('HotRox|Other', 'hotrox');
  assert.equal(result.added, false);
  assert.equal(result.value, 'HotRox|Other');
});

test('assertAliasColumnPresent requires header', () => {
  assert.throws(
    () => assertAliasColumnPresent({ headers: ['Song Title'] }, 'Aliases'),
    /Aliases column/
  );
  assert.equal(
    assertAliasColumnPresent({ headers: ['Song Title', 'Aliases'] }, 'Aliases'),
    'Aliases'
  );
});

test('searchSheetRows ranks title and ALS Folder hits', () => {
  const snapshot = {
    rows: [
      {
        rowId: '70',
        data: {
          'Song Title': 'Hot Like Rox',
          Aliases: '',
          'ALS Folder': 'Ebm_80bpm_HotRox_24',
        },
      },
      {
        rowId: '71',
        data: {
          'Song Title': 'Hot Like Sauce',
          Aliases: '',
          'ALS Folder': 'Dm_90bpm_HotLikeSauce_24',
        },
      },
    ],
  };

  const results = searchSheetRows(snapshot, {
    query: 'HotRox',
    matchColumn: 'Song Title',
    aliasColumn: 'Aliases',
    secondaryColumns: ['ALS Folder'],
    limit: 10,
  });

  assert.equal(results[0].rowId, '70');
  assert.equal(results[0].title, 'Hot Like Rox');
});
