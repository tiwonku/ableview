import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderProgramPanel } from '../public/shared/admin-program.js';

const recorded = JSON.parse(readFileSync(
  new URL('./fixtures/program-deck-state.json', import.meta.url),
  'utf8',
));

function installDocument() {
  function createElement(tag) {
    const classes = new Set();
    const attrs = {};
    const node = {
      tagName: tag,
      textContent: '',
      hidden: false,
      childNodes: [],
      style: { setProperty() {} },
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        contains: (name) => classes.has(name),
      },
      setAttribute(name, value) {
        attrs[name] = String(value);
      },
      getAttribute(name) {
        return attrs[name];
      },
      appendChild(child) {
        node.childNodes.push(child);
        return child;
      },
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
    Object.defineProperty(node, 'innerHTML', {
      get() {
        return '';
      },
      set() {
        node.childNodes.length = 0;
      },
    });
    return node;
  }

  globalThis.document = { createElement };
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

test('recorded program JSON paints titles, playing, and ON AIR', () => {
  installDocument();
  const mount = document.createElement('section');
  renderProgramPanel(mount, recorded);

  assert.equal(mount.hidden, false);
  assert.equal(mount.getAttribute('aria-label'), 'Program sources');
  assert.equal(findAll(mount, 'section-title').length, 1);

  const titles = findAll(mount, 'admin-program-deck-title').map(textOf);
  assert.deepEqual(titles, [
    'What It Sounds Like (AWAIAN Remix)',
    'My Way (Remix)',
    'Waiting on a title',
  ]);

  const onAir = findAll(mount, 'program-badge--on-air');
  assert.equal(onAir.length, 1);
  assert.equal(textOf(onAir[0]), 'ON AIR');

  const playing = findAll(mount, 'program-badge--playing');
  assert.equal(playing.length, 1);
  assert.equal(textOf(playing[0]), 'Playing');

  const sources = findAll(mount, 'admin-program-source');
  assert.equal(sources.length, 2);
  assert.equal(sources[0].classList.contains('admin-program-source--live'), true);
  assert.equal(textOf(findAll(sources[0], 'admin-program-source-label')[0]), 'D');
  assert.equal(sources[1].classList.contains('admin-program-source--stale'), true);
  assert.match(textOf(sources[1]), /Stale/);
  assert.match(textOf(sources[1]), /Waiting on a title/);

  const meta = textOf(findAll(mount, 'admin-program-deck-meta')[0]);
  assert.match(meta, /HUNTR\/X/);
  assert.match(meta, /124/);
  assert.match(meta, /e minor/);
});

test('compact dashboard strip keeps ON AIR and drops the section heading', () => {
  installDocument();
  const mount = document.createElement('section');
  renderProgramPanel(mount, recorded, { compact: true });

  assert.equal(mount.classList.contains('admin-program--compact'), true);
  assert.equal(findAll(mount, 'section-title').length, 0);
  assert.equal(findAll(mount, 'program-badge--on-air').length, 1);
  assert.match(textOf(mount), /What It Sounds Like/);
});

test('no configured sources hides the panel', () => {
  installDocument();
  const mount = document.createElement('section');
  renderProgramPanel(mount, { timestamp: null, sources: [] });
  assert.equal(mount.hidden, true);
  assert.equal(mount.childNodes.length, 0);
});
