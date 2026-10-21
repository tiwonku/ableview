import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSetlist, shouldOfferNewCueRow } from '../public/shared/setlist-render.js';

function installDocument() {
  function querySelector(node, selector) {
    if (selector.startsWith('.') && node.classList?.contains(selector.slice(1))) return node;
    const field = selector.match(/^\[data-setlist-field="(.+)"\]$/)?.[1];
    if (field && node.dataset?.setlistField === field) return node;
    for (const child of node.childNodes || []) {
      const found = querySelector(child, selector);
      if (found) return found;
    }
    return null;
  }

  function createElement(tag) {
    const classes = new Set();
    const attrs = {};
    const node = {
      tagName: tag,
      textContent: '',
      hidden: false,
      isConnected: false,
      childNodes: [],
      dataset: {},
      style: { setProperty() {} },
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        remove(...names) {
          for (const name of names) classes.delete(name);
        },
        toggle(name, force) {
          if (force === false || (force == null && classes.has(name))) classes.delete(name);
          else classes.add(name);
        },
        contains: (name) => classes.has(name),
      },
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      getAttribute(name) {
        return attrs[name];
      },
      addEventListener(type, fn) {
        node.listeners = node.listeners || {};
        node.listeners[type] = fn;
      },
      appendChild(child) {
        node.childNodes.push(child);
        child.parentNode = node;
        return child;
      },
      replaceChildren(...children) {
        node.childNodes = children;
      },
      querySelector(selector) {
        return querySelector(node, selector);
      },
      focus() {},
      select() {},
      scrollIntoView() {},
    };
    Object.defineProperty(node, 'className', {
      get() {
        return [...classes].join(' ');
      },
      set(value) {
        classes.clear();
        for (const name of String(value).split(/\s+/)) {
          if (name) classes.add(name);
        }
      },
    });
    return node;
  }

  globalThis.document = {
    createElement,
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    },
  };
}

function textOf(node) {
  const own = node.textContent || '';
  return own + (node.childNodes || []).map(textOf).join('');
}

function findAll(node, className) {
  const out = [];
  if (node.classList?.contains(className)) out.push(node);
  for (const child of node.childNodes || []) out.push(...findAll(child, className));
  return out;
}

const goodDay = {
  rowId: '214',
  title: 'Good Day',
  key: 'Cm',
  aliases: 'AGoodDaySTEMS',
};

function renderAdd(overrides = {}) {
  installDocument();
  const root = document.createElement('div');
  renderSetlist(root, {
    title: 'Set',
    payload: { match: { matched: false }, clipName: null },
    setlist: { name: 'Tonight', items: [], library: [{ name: 'Tonight', itemCount: 0 }] },
    matchColumn: 'Song Title',
    connected: true,
    addOpen: true,
    addQuery: 'Always a Good Day',
    addResults: [goodDay],
    onCreateCue() {},
    ...overrides,
  });
  return root;
}

test('shouldOfferNewCueRow allows a longer different title', () => {
  assert.equal(shouldOfferNewCueRow('Always a Good Day', [goodDay]), true);
  assert.equal(shouldOfferNewCueRow('Good Day', [goodDay]), false);
  assert.equal(shouldOfferNewCueRow('good', [goodDay]), false);
  assert.equal(shouldOfferNewCueRow('AGoodDaySTEMS', [goodDay]), false);
  assert.equal(shouldOfferNewCueRow('Brand New Tune', []), true);
  assert.equal(shouldOfferNewCueRow('   ', [goodDay]), false);
});

test('similar cue-sheet hit still offers a new row for the typed title', () => {
  const root = renderAdd();
  const text = textOf(root);
  assert.match(text, /Good Day/);
  assert.match(text, /Always a Good Day/);
  assert.match(text, /different song/);
  assert.equal(findAll(root, 'setlist-create').length, 1);
  assert.equal(findAll(root, 'alias-search-result').length, 1);
});

test('exact cue-sheet title does not offer a duplicate row', () => {
  const root = renderAdd({ addQuery: 'Good Day', addResults: [goodDay] });
  assert.equal(findAll(root, 'setlist-create').length, 0);
});

test('empty search still offers a new cue row', () => {
  const root = renderAdd({ addQuery: 'Brand New Tune', addResults: [] });
  const text = textOf(root);
  assert.match(text, /No cue row for “Brand New Tune”/);
  assert.equal(findAll(root, 'setlist-create').length, 1);
});

test('each setlist row has an edit button and a missing row cannot open it', () => {
  installDocument();
  const root = document.createElement('div');
  const opened = [];
  renderSetlist(root, {
    title: 'Set',
    payload: { match: { matched: false } },
    setlist: {
      name: 'Tonight',
      items: [
        { rowId: '234', title: 'Always a Good Day', key: 'Dbm', status: 'confirmed' },
        { rowId: '9', title: 'Gone', status: 'likely', missing: true },
      ],
      library: [{ name: 'Tonight', itemCount: 2 }],
    },
    connected: true,
    onEditItem: (rowId) => opened.push(rowId),
  });
  const buttons = findAll(root, 'setlist-item-edit');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].textContent, 'Edit');
  assert.equal(buttons[0].disabled, false);
  assert.match(buttons[0].title, /Always a Good Day/);
  assert.equal(buttons[1].disabled, true);
  buttons[0].listeners.click();
  assert.deepEqual(opened, ['234']);
  buttons[1].listeners.click();
  assert.deepEqual(opened, ['234']);
});
