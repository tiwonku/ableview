import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDopeFlashTracker,
  dopeFlashParts,
  formatDopeTime,
  paintAdminDopeSlot,
} from '../public/shared/admin-dope-flash.js';

const HOLD = 30_000;

function moment(loggedAt, extras = {}) {
  return {
    kind: 'dope',
    who: 'griff',
    timestamp: '19:17:05;12',
    loggedAt,
    ...extras,
  };
}

test('formatDopeTime drops SMPTE frames', () => {
  assert.equal(formatDopeTime('19:17:05;12', null), '19:17:05');
  assert.equal(formatDopeTime('7:04:09:03', null), '07:04:09');
  assert.equal(formatDopeTime('', 'not-a-date'), '');
});

test('a dope press shows for 30 seconds and then clears', () => {
  let now = 1_000_000;
  const tracker = createDopeFlashTracker({ now: () => now, holdMs: HOLD });
  const loggedAt = new Date(now).toISOString();

  const first = tracker.ingest(moment(loggedAt));
  assert.equal(first.added, true);
  assert.equal(first.snapshot.count, 1);
  assert.equal(first.snapshot.who, 'griff');
  assert.equal(first.snapshot.remainingMs, HOLD);

  now += HOLD - 1;
  assert.equal(tracker.snapshot().count, 1);

  now += 1;
  assert.equal(tracker.snapshot(), null);
  assert.equal(tracker.nextChangeMs(), null);
});

test('a press older than 30 seconds is not shown on connect', () => {
  let now = 5_000_000;
  const tracker = createDopeFlashTracker({ now: () => now, holdMs: HOLD });
  const loggedAt = new Date(now - HOLD).toISOString();
  const result = tracker.ingest(moment(loggedAt));
  assert.equal(result.added, false);
  assert.equal(result.snapshot, null);
});

test('another press restarts the hold and counts presses still in the window', () => {
  let now = 2_000_000;
  const tracker = createDopeFlashTracker({ now: () => now, holdMs: HOLD });
  tracker.ingest(moment(new Date(now).toISOString(), { who: 'griff' }));

  now += 10_000;
  const second = tracker.ingest(moment(new Date(now).toISOString(), {
    who: 'nik',
    timestamp: '19:17:15;00',
  }));
  assert.equal(second.added, true);
  assert.equal(second.snapshot.count, 2);
  assert.equal(second.snapshot.who, 'nik');
  assert.equal(second.snapshot.remainingMs, HOLD);

  now += HOLD - 10_000;
  const aged = tracker.snapshot();
  assert.equal(aged.count, 1);
  assert.equal(aged.who, 'nik');
  assert.ok(tracker.nextChangeMs() <= 10_000);
});

test('the same moment and non-dope kinds do not add another press', () => {
  let now = 3_000_000;
  const tracker = createDopeFlashTracker({ now: () => now, holdMs: HOLD });
  const loggedAt = new Date(now).toISOString();
  tracker.ingest(moment(loggedAt));
  const again = tracker.ingest(moment(loggedAt));
  assert.equal(again.added, false);
  assert.equal(again.snapshot.count, 1);

  now += 1000;
  const typed = tracker.ingest({
    kind: 'typed',
    who: 'setlist',
    note: 'crowd',
    loggedAt: new Date(now).toISOString(),
  });
  assert.equal(typed.added, false);
  assert.equal(typed.snapshot.count, 1);
  assert.equal(typed.snapshot.who, 'griff');
});

test('dopeFlashParts reads kind, who, time, and a count when several landed', () => {
  assert.equal(dopeFlashParts(null), null);
  const one = dopeFlashParts({
    who: 'griff',
    timestamp: '19:17:05;12',
    loggedAt: '2026-10-07T01:17:05.000Z',
    count: 1,
  });
  assert.equal(one.kind, 'Dope');
  assert.equal(one.who, 'griff');
  assert.equal(one.time, '19:17:05');
  assert.equal(one.count, null);
  assert.equal(one.label, 'Dope, griff, 19:17:05');

  const many = dopeFlashParts({
    who: null,
    timestamp: '19:17:05;12',
    count: 5,
  });
  assert.equal(many.who, null);
  assert.equal(many.count, 5);
  assert.equal(many.label, 'Dope, 5 presses, 19:17:05');
});

function element(tag) {
  const children = [];
  const classes = new Set();
  const attrs = {};
  const node = {
    tagName: tag,
    textContent: '',
    hidden: false,
    dataset: {},
    childNodes: children,
    parentNode: null,
    ownerDocument: null,
    offsetWidth: 1,
    style: {},
    classList: {
      add(...names) { for (const name of names) classes.add(name); },
      remove(...names) { for (const name of names) classes.delete(name); },
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name]; },
    appendChild(child) {
      children.push(child);
      child.parentNode = node;
      return child;
    },
    insertBefore(child, before) {
      const index = before ? children.indexOf(before) : children.length;
      children.splice(index < 0 ? children.length : index, 0, child);
      child.parentNode = node;
      return child;
    },
    removeChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      child.parentNode = null;
      return child;
    },
    querySelector(selector) {
      const className = String(selector).split('.').pop();
      const walk = (current) => {
        if (current.classList.contains(className)) return current;
        for (const child of current.childNodes) {
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(node);
    },
  };
  Object.defineProperty(node, 'className', {
    get() { return [...classes].join(' '); },
    set(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/)) {
        if (name) classes.add(name);
      }
    },
  });
  Object.defineProperty(node, 'firstChild', {
    get() { return children[0] ?? null; },
  });
  node.ownerDocument = {
    createElement: element,
  };
  return node;
}

test('paint inserts the flash above the color row and removes it when clear', () => {
  const root = element('main');
  const mast = element('div');
  mast.className = 'admin-dashboard-mast';
  const colors = element('div');
  colors.className = 'colors-row';
  mast.appendChild(colors);
  root.appendChild(mast);

  const shown = paintAdminDopeSlot(root, {
    who: 'griff',
    timestamp: '19:17:05;12',
    loggedAt: '2026-10-07T01:17:05.000Z',
    count: 2,
    remainingMs: 1000,
  }, { pulse: true });

  assert.equal(shown, true);
  assert.equal(mast.firstChild.classList.contains('admin-dope-slot'), true);
  assert.equal(mast.firstChild.classList.contains('admin-dope-slot--pulse'), true);
  assert.equal(mast.childNodes[1], colors);
  assert.match(mast.firstChild.getAttribute('aria-label'), /griff/);
  assert.match(mast.firstChild.getAttribute('aria-label'), /19:17:05/);

  paintAdminDopeSlot(root, null);
  assert.equal(mast.querySelector('admin-dope-slot'), null);
  assert.equal(mast.firstChild, colors);
});

test('paint leaves the layout alone when the dashboard look is not mounted', () => {
  const root = element('main');
  assert.equal(paintAdminDopeSlot(root, {
    who: 'griff',
    timestamp: '19:17:05;12',
    count: 1,
  }), false);
  assert.equal(root.childNodes.length, 0);
});
