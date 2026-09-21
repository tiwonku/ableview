import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  captureMountedFieldFocus,
  mountedFieldHostVisible,
  parkSessionLogForRender,
  placeSessionLogMount,
  restoreMountedFieldFocus,
} from '../public/shared/admin-session-log.js';

function createDoc() {
  let active = null;
  const all = [];

  function mark(node, connected) {
    node.isConnected = connected;
    for (const child of node.childNodes) mark(child, connected);
  }

  function el(tag) {
    const node = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      type: 'text',
      hidden: false,
      parentNode: null,
      childNodes: [],
      isConnected: false,
      selectionStart: null,
      selectionEnd: null,
      attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      appendChild(child) {
        if (child.parentNode) {
          const index = child.parentNode.childNodes.indexOf(child);
          if (index >= 0) child.parentNode.childNodes.splice(index, 1);
        }
        child.parentNode = node;
        node.childNodes.push(child);
        mark(child, node.isConnected);
        return child;
      },
      contains(other) {
        let current = other;
        while (current) {
          if (current === node) return true;
          current = current.parentNode;
        }
        return false;
      },
      focus() { active = node; },
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      remove() {
        if (!this.parentNode) return;
        const index = this.parentNode.childNodes.indexOf(this);
        if (index >= 0) this.parentNode.childNodes.splice(index, 1);
        this.parentNode = null;
        mark(this, false);
      },
    };
    all.push(node);
    return node;
  }

  const body = el('body');
  body.isConnected = true;
  const doc = {
    body,
    documentElement: el('html'),
    get activeElement() { return active ?? body; },
    createElement: el,
    getElementById(id) {
      return all.find((node) => node.id === id && node.isConnected) ?? null;
    },
  };

  return {
    doc,
    el,
    focus(node) { active = node; },
    blur() { active = body; },
  };
}

function mountNote(docApi, parent) {
  const { el, focus } = docApi;
  const mount = el('div');
  parent.appendChild(mount);
  const input = el('input');
  input.selectionStart = 4;
  input.selectionEnd = 4;
  mount.appendChild(input);
  focus(input);
  return { mount, input };
}

test('Set redraw leaves the note field in #session-log', () => {
  const docApi = createDoc();
  const host = docApi.el('section');
  host.id = 'session-log';
  docApi.doc.body.appendChild(host);
  const { mount, input } = mountNote(docApi, host);

  const saved = parkSessionLogForRender(mount, { viewId: 'setlist', doc: docApi.doc });

  assert.equal(mount.parentNode, host);
  assert.equal(saved.el, input);
  assert.equal(saved.start, 4);
  assert.equal(docApi.doc.getElementById('session-log-park'), null);
  assert.equal(restoreMountedFieldFocus(saved, docApi.doc), false);
  assert.equal(docApi.doc.activeElement, input);
});

test('admin redraw parks the note field, then restores the caret', () => {
  const docApi = createDoc();
  const drawer = docApi.el('div');
  drawer.id = 'admin-set-log';
  docApi.doc.body.appendChild(drawer);
  const { mount, input } = mountNote(docApi, drawer);

  const saved = parkSessionLogForRender(mount, { viewId: 'admin', doc: docApi.doc });
  const park = docApi.doc.getElementById('session-log-park');

  assert.equal(mount.parentNode, park);
  assert.equal(park.hidden, false);
  assert.equal(park.className, 'session-log-park');
  assert.equal(mountedFieldHostVisible(input), false);

  docApi.blur();
  drawer.remove();
  const nextDrawer = docApi.el('div');
  nextDrawer.id = 'admin-set-log';
  docApi.doc.body.appendChild(nextDrawer);

  assert.equal(placeSessionLogMount(mount, { viewId: 'admin', doc: docApi.doc }), true);
  assert.equal(mount.parentNode, nextDrawer);
  assert.equal(restoreMountedFieldFocus(saved, docApi.doc), true);
  assert.equal(docApi.doc.activeElement, input);
  assert.equal(input.selectionStart, 4);
  assert.equal(input.selectionEnd, 4);
});

test('caret restore yields when focus has moved to another field', () => {
  const docApi = createDoc();
  const drawer = docApi.el('div');
  drawer.id = 'admin-set-log';
  docApi.doc.body.appendChild(drawer);
  const { mount, input } = mountNote(docApi, drawer);
  const saved = captureMountedFieldFocus(mount, docApi.doc);

  const other = docApi.el('input');
  docApi.doc.body.appendChild(other);
  other.focus();

  assert.equal(restoreMountedFieldFocus(saved, docApi.doc), false);
  assert.equal(docApi.doc.activeElement, other);
  assert.equal(input.selectionStart, 4);
});

test('ws-client keeps the log bar mounted across cue redraws', () => {
  const clientSrc = readFileSync(
    fileURLToPath(new URL('../public/shared/ws-client.js', import.meta.url)),
    'utf8',
  );
  const css = readFileSync(
    fileURLToPath(new URL('../public/shared/styles.css', import.meta.url)),
    'utf8',
  );
  const parkFn = clientSrc.match(/function parkSessionLogMount\(\) \{[\s\S]*?\n  \}/);
  assert.ok(parkFn, 'parkSessionLogMount should exist');
  assert.match(parkFn[0], /parkSessionLogForRender/);
  assert.doesNotMatch(parkFn[0], /\.remove\(/);
  assert.match(clientSrc, /placeSessionLogMount/);
  assert.match(clientSrc, /restoreMountedFieldFocus/);
  assert.match(clientSrc, /sessionLogMountEl\?\.remove\(\)/);
  const parkCss = css.match(/\.session-log-park \{[\s\S]*?\}/);
  assert.ok(parkCss, 'session-log-park rule should exist');
  assert.doesNotMatch(parkCss[0], /display:\s*none/);
  assert.doesNotMatch(parkCss[0], /visibility:\s*hidden/);
});
