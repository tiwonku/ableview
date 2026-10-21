import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { horizontalPeekWheelDelta, setlistPreviewModel } from '../public/shared/setlist-preview.js';

const color = (value, column = 'RGB_1', label = 'Color 1') => ({ column, label, value });

function night(items) {
  return { name: 'Mempho-26', items };
}

test('preview shows the live setlist song and the next two with key and colors', () => {
  const model = setlistPreviewModel({
    match: { matched: true, rowId: '2', matchedValue: 'B' },
  }, night([
    { rowId: '1', title: 'A', key: '1A', colors: [color('1,0,0')] },
    { rowId: '2', liveTitle: 'Bee', title: 'B', key: '2A', colors: [color('0,128,0', 'RGB_2', 'Color 2')] },
    { rowId: '3', title: 'C', key: '3A', status: 'maybe', colors: [color('0,0,255')] },
    { rowId: '4', title: 'D', key: '4A', colors: [] },
  ]));

  assert.equal(model.name, 'Mempho-26');
  assert.equal(model.onSet, true);
  assert.equal(model.currentIndex, 1);
  assert.equal(model.currentRowId, '2');
  assert.deepEqual(model.slots.map((slot) => slot.role), ['now', 'next', 'after']);
  assert.deepEqual(model.slots.map((slot) => slot.title), ['Bee', 'C', 'D']);
  assert.equal(model.slots[0].key, '2A');
  assert.equal(model.slots[0].current, true);
  assert.deepEqual(model.slots[0].colors, [color('0,128,0', 'RGB_2', 'Color 2')]);
  assert.equal(model.slots[1].status, 'maybe');
  assert.equal(model.slots[1].key, '3A');
  assert.equal(model.items[0].played, true);
  assert.equal(model.items[1].current, true);
  assert.equal(model.items[1].played, false);
  assert.equal(model.items[3].current, false);
});

test('the last songs leave the later preview slots empty', () => {
  const model = setlistPreviewModel({
    match: { matched: true, rowId: '9', viaOverride: true },
  }, night([
    { rowId: '8', title: 'Earlier', key: '8A' },
    { rowId: '9', title: 'Finale', key: '9A', colors: [color('9,9,9')] },
  ]));

  assert.equal(model.slots[0].title, 'Finale');
  assert.equal(model.slots[0].pinned, true);
  assert.equal(model.slots[0].key, '9A');
  assert.equal(model.slots[1].empty, true);
  assert.equal(model.slots[2].empty, true);
  assert.equal(model.items[0].played, true);
  assert.equal(model.items[1].pinned, true);
});

test('a matched song that is not on the set does not borrow the next setlist rows', () => {
  const model = setlistPreviewModel({
    clipName: 'Other',
    match: { matched: true, matchedValue: 'Other Song', rowId: '999' },
    row: { Key: '4A', RGB_1: '10,20,30', 'Clip Name': 'Other Song' },
  }, night([
    { rowId: '1', title: 'First', key: '8A', colors: [color('1,1,1')] },
  ]), {
    matchColumn: 'Clip Name',
    colorColumns: [{ column: 'RGB_1', label: 'Color 1' }],
  });

  assert.equal(model.onSet, false);
  assert.equal(model.currentIndex, -1);
  assert.equal(model.currentRowId, null);
  assert.equal(model.slots[0].title, 'Other Song');
  assert.equal(model.slots[0].offSet, true);
  assert.equal(model.slots[0].key, '4A');
  assert.deepEqual(model.slots[0].colors, [color('10,20,30')]);
  assert.equal(model.slots[1].empty, true);
  assert.equal(model.slots[2].empty, true);
  assert.equal(model.items[0].current, false);
});

test('a below-threshold match does not preview a setlist row', () => {
  const model = setlistPreviewModel({
    clipName: 'Almost',
    match: { matched: false },
    lastMatched: {
      title: 'Still Night',
      rowId: '146',
      row: { Key: '8A', RGB_1: '1,2,3' },
    },
  }, night([
    { rowId: '146', liveTitle: 'Still Night', key: '8A', colors: [color('1,2,3')] },
  ]));

  assert.equal(model.matched, false);
  assert.equal(model.currentIndex, -1);
  assert.equal(model.slots[0].unmatched, true);
  assert.equal(model.slots[0].title, 'Almost');
  assert.equal(model.slots[0].key, '');
  assert.deepEqual(model.slots[0].colors, []);
  assert.equal(model.slots[1].empty, true);
  assert.equal(model.items[0].current, false);
  assert.equal(model.items[0].played, false);
});

test('waiting and an empty set stay explicit', () => {
  const waiting = setlistPreviewModel(null, night([{ rowId: '1', title: 'A', key: '1A' }]));
  assert.equal(waiting.slots[0].waiting, true);
  assert.equal(waiting.slots[0].title, 'Waiting…');
  assert.equal(waiting.items[0].current, false);

  const empty = setlistPreviewModel({
    match: { matched: true, rowId: '5', matchedValue: 'Solo' },
    row: { Key: '11B' },
  }, { name: 'night', items: [] });
  assert.equal(empty.items.length, 0);
  assert.equal(empty.slots[0].offSet, true);
  assert.equal(empty.slots[0].title, 'Solo');
  assert.equal(empty.slots[0].key, '11B');
  assert.equal(empty.slots[1].empty, true);
});

test('a vertical mouse wheel scrolls the sideways peek, a sideways gesture does not', () => {
  assert.equal(horizontalPeekWheelDelta({ deltaY: 120 }), 120);
  assert.equal(horizontalPeekWheelDelta({ deltaY: -40 }), -40);
  assert.equal(horizontalPeekWheelDelta({ deltaY: 3, deltaMode: 1 }), 144);
  assert.equal(horizontalPeekWheelDelta({ deltaY: 1, deltaMode: 2, clientWidth: 800 }), 800);
  assert.equal(horizontalPeekWheelDelta({ deltaX: 80, deltaY: 10 }), null);
  assert.equal(horizontalPeekWheelDelta({ deltaY: 0 }), null);
});

test('lighting view places the setlist module where Automation was', () => {
  const example = JSON.parse(readFileSync(
    fileURLToPath(new URL('../config/config.example.json', import.meta.url)),
    'utf8',
  ));
  const lighting = example.views.lighting.fields;
  assert.equal(lighting.some((field) => field.column === 'Automation'), false);
  const module = lighting.find((field) => field.type === 'setlist');
  assert.equal(module.label, 'Set');
  assert.equal(module.column, undefined);

  const view = readFileSync(fileURLToPath(new URL('../public/shared/view-render.js', import.meta.url)), 'utf8');
  const client = readFileSync(fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)), 'utf8');
  assert.match(view, /renderSetlistModule/);
  assert.match(client, /setlist: lastSetlist/);
  assert.match(client, /field\?\.type === 'setlist'/);
});
