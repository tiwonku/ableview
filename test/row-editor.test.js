import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureEditSession,
  captureCreateSession,
  buildViewEditorColumns,
  buildFieldLabels,
  viewFieldColumns,
} from '../public/shared/admin-row-editor.js';

const payload = {
  clipName: 'Song A',
  match: { matched: true, rowId: '12', matchedValue: 'Song A' },
  row: {
    Key: 'Ebm',
    'Relative Key': 'Gb',
    BPM: '90.2',
    RGB_1: '17,85,204',
    'Lighting Notes': 'Go big',
  },
};

test('captureEditSession scopes row to view columns', () => {
  const session = captureEditSession(payload, {
    columns: ['Key', 'BPM'],
  });

  assert.equal(session.rowId, '12');
  assert.deepEqual(session.row, { Key: 'Ebm', BPM: '90.2' });
  assert.equal(session.clipNameAtEdit, 'Song A');
});

test('captureEditSession includes full row when columns omitted', () => {
  const session = captureEditSession(payload);
  assert.equal(Object.keys(session.row).length, 5);
});

test('viewFieldColumns preserves field order', () => {
  const fields = [
    { column: 'RGB_1', type: 'color' },
    { column: 'Video World' },
    { column: 'BPM' },
  ];
  assert.deepEqual(viewFieldColumns(fields), ['RGB_1', 'Video World', 'BPM']);
});

test('buildFieldLabels uses view labels', () => {
  const fields = [
    { column: 'RGB_1', label: 'Color 1', type: 'color' },
    { column: 'BPM' },
  ];
  assert.deepEqual(buildFieldLabels(fields), {
    RGB_1: 'Color 1',
    BPM: 'BPM',
  });
});

test('captureCreateSession scopes row to view columns', () => {
  const session = captureCreateSession({
    clipName: 'New Clip',
    headers: ['Song Title', 'Key', 'BPM', 'Lighting Notes'],
    matchColumn: 'Song Title',
    columns: ['Key', 'BPM'],
  });

  assert.equal(session.mode, 'create');
  assert.deepEqual(session.row, { Key: '', BPM: '' });
  assert.equal(session.clipNameAtEdit, 'New Clip');
});

test('captureCreateSession pre-fills matchColumn when in scoped list', () => {
  const session = captureCreateSession({
    clipName: 'New Clip',
    headers: ['Song Title', 'Key', 'BPM'],
    matchColumn: 'Song Title',
    columns: ['Song Title', 'Key'],
  });

  assert.deepEqual(session.row, { 'Song Title': 'New Clip', Key: '' });
});

test('captureCreateSession uses all headers when columns omitted', () => {
  const session = captureCreateSession({
    clipName: 'New Clip',
    headers: ['Song Title', 'Key', 'BPM'],
    matchColumn: 'Song Title',
  });

  assert.deepEqual(session.row, {
    'Song Title': 'New Clip',
    Key: '',
    BPM: '',
  });
});

test('buildViewEditorColumns merges editorColumns and field types', () => {
  const fields = [
    { column: 'BPM' },
    { column: 'RGB_1', type: 'color' },
    { column: 'Video World' },
  ];
  const editorColumns = {
    BPM: { type: 'number', step: 0.1 },
  };

  assert.deepEqual(buildViewEditorColumns(fields, editorColumns), {
    BPM: { type: 'number', step: 0.1 },
    RGB_1: { type: 'color' },
    'Video World': { type: 'text' },
  });
});
