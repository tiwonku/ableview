import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paintAdminDopeSlot, paintAdminDopeTally } from '../public/shared/admin-dope-flash.js';
import { heartRateGlance, paintAdminHeartRate } from '../public/shared/admin-heart-rate.js';

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
  node.ownerDocument = { createElement: element };
  return node;
}

function mastWithColors() {
  const root = element('main');
  const mast = element('div');
  mast.className = 'admin-dashboard-mast';
  mast.hidden = true;
  const colors = element('div');
  colors.className = 'colors-row';
  mast.appendChild(colors);
  root.appendChild(mast);
  return { root, mast, colors };
}

const orbit = {
  enabled: true,
  participants: [
    { memberName: 'Derek', heartRate: 92, active: true },
    { memberName: 'station3', heartRate: 101.4, active: true },
    { memberId: 'quiet-watch', heartRate: 80, active: false },
    { memberName: 'flat', heartRate: 0, active: true },
  ],
};

test('heartRateGlance lists live rates and skips a zero reading', () => {
  const glance = heartRateGlance(orbit);
  assert.deepEqual(glance.rows, [
    { name: 'Derek', bpm: 92, quiet: false },
    { name: 'station3', bpm: 101, quiet: false },
    { name: 'quiet-watch', bpm: 80, quiet: true },
  ]);
  assert.equal(glance.label, 'Heart rate: Derek 92, station3 101, quiet-watch 80');
  assert.equal(heartRateGlance({ enabled: false, participants: orbit.participants }), null);
  assert.equal(heartRateGlance(null), null);
});

test('the strip sits under the dope banner and stays quieter about a stalled watch', () => {
  const { root, mast, colors } = mastWithColors();
  paintAdminDopeSlot(root, {
    who: 'Derek',
    timestamp: '19:17:05;12',
    loggedAt: '2026-11-07T01:17:05.000Z',
    count: 1,
    remainingMs: 1000,
  });
  paintAdminDopeTally(root, [{ who: 'Derek', count: 6 }]);

  const shown = paintAdminHeartRate(root, orbit);
  assert.equal(shown, true);
  assert.equal(mast.hidden, false);
  assert.equal(mast.childNodes[0].classList.contains('admin-dope-slot'), true);
  assert.equal(mast.childNodes[1].classList.contains('admin-dope-tally'), true);
  const strip = mast.childNodes[2];
  assert.equal(strip.classList.contains('admin-heart-slot'), true);
  assert.equal(mast.childNodes[3], colors);
  assert.equal(strip.getAttribute('aria-label'), glanceLabel());
  assert.equal(strip.childNodes[0].textContent, 'HR');
  const people = strip.childNodes.filter((node) => node.classList.contains('admin-heart-person'));
  assert.equal(people.length, 3);
  assert.equal(people[0].childNodes[0].textContent, 'Derek');
  assert.equal(people[0].childNodes[1].textContent, '92');
  assert.equal(people[0].childNodes[2].textContent, 'bpm');
  assert.equal(people[2].classList.contains('admin-heart-person--quiet'), true);
  assert.equal(people[0].classList.contains('admin-heart-person--quiet'), false);

  paintAdminDopeSlot(root, null);
  paintAdminDopeTally(root, []);
  assert.equal(mast.querySelector('.admin-heart-slot'), strip);
  assert.equal(mast.hidden, false);
  assert.equal(mast.firstChild, strip);

  paintAdminHeartRate(root, { enabled: false, participants: [] });
  assert.equal(mast.querySelector('.admin-heart-slot'), null);
  assert.equal(mast.hidden, true);
  assert.equal(mast.firstChild, colors);
});

function glanceLabel() {
  return heartRateGlance(orbit).label;
}

test('a heart strip does not hide the color row when the mast was already open', () => {
  const { root, mast, colors } = mastWithColors();
  mast.hidden = false;
  paintAdminHeartRate(root, orbit);
  paintAdminHeartRate(root, null);
  assert.equal(mast.hidden, false);
  assert.equal(mast.firstChild, colors);
});

test('with no look on screen the strip leads the dashboard board', () => {
  const root = element('main');
  const board = element('div');
  board.className = 'admin-dashboard-board';
  const panel = element('div');
  panel.className = 'no-match-panel';
  board.appendChild(panel);
  root.appendChild(board);

  assert.equal(paintAdminHeartRate(root, orbit), true);
  assert.equal(board.firstChild.classList.contains('admin-heart-slot--board'), true);
  assert.equal(board.childNodes[1], panel);
  assert.equal(board.firstChild.getAttribute('aria-label'), glanceLabel());

  paintAdminHeartRate(root, null);
  assert.equal(board.querySelector('.admin-heart-slot'), null);
  assert.equal(board.firstChild, panel);
});

test('paint leaves the layout alone when the dashboard is not mounted', () => {
  const root = element('main');
  assert.equal(paintAdminHeartRate(root, orbit), false);
});
