import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlayingClipsStrip } from '../public/shared/playing-clips-strip.js';
import { renderSessionTracks } from '../public/shared/session-tracks.js';

function installDocument() {
  function el(tag) {
    const classes = new Set();
    const node = {
      tagName: tag,
      textContent: '',
      childNodes: [],
      style: { setProperty() {} },
      classList: {
        add(...names) {
          for (const name of names) classes.add(name);
        },
        contains: (name) => classes.has(name),
      },
      setAttribute() {},
      appendChild(child) {
        node.childNodes.push(child);
        return child;
      },
      addEventListener() {},
      get childElementCount() {
        return node.childNodes.length;
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
    node.className = '';
    return node;
  }

  globalThis.document = { createElement: el };
}

installDocument();

function collect(node, pred, out = []) {
  if (pred(node)) out.push(node);
  for (const child of node.childNodes ?? []) collect(child, pred, out);
  return out;
}

function buttonLabels(root) {
  return collect(root, (node) => node.tagName === 'button').map((node) => node.textContent);
}

const arrangementPayload = {
  match: { matched: false },
  tracks: [
    {
      trackIndex: 11,
      trackName: 'DECK A',
      clipName: 'HWDED STAB INTRO',
      source: 'arrangement',
    },
    {
      trackIndex: 12,
      trackName: 'DECK B',
      clipName: 'Yellow Bird',
      source: 'session',
    },
  ],
  trackMatches: [
    {
      trackIndex: 11,
      trackName: 'DECK A',
      clipName: 'HWDED STAB INTRO',
      matched: false,
      excluded: 'arrangement',
    },
    {
      trackIndex: 12,
      trackName: 'DECK B',
      clipName: 'Yellow Bird',
      matched: false,
    },
  ],
};

test('no-match strip hides alias and cue-row actions on excluded arrangement clips', () => {
  const root = document.createElement('div');
    renderPlayingClipsStrip(root, arrangementPayload, {
      onStartAlias() {},
      onStartCreate() {},
    });
    const chips = collect(root, (node) => node.classList.contains('playing-clip-chip'));
    assert.equal(chips.length, 2);

    const arrangement = chips.find((chip) => collect(chip, (node) => node.textContent === 'DECK A').length);
    const session = chips.find((chip) => collect(chip, (node) => node.textContent === 'DECK B').length);

    assert.deepEqual(buttonLabels(arrangement), []);
    assert.equal(
      collect(arrangement, (node) => node.textContent === 'Arrangement').length > 0,
      true
    );
    assert.equal(arrangement.classList.contains('playing-clip-chip--nomatch'), false);

    assert.deepEqual(buttonLabels(session), ['Add as alias', 'Add cue row']);
    assert.equal(
      collect(session, (node) => node.textContent === 'No match').length > 0,
      true
    );
    assert.equal(session.classList.contains('playing-clip-chip--nomatch'), true);
});

test('session board hides alias and cue-row actions on excluded arrangement clips', () => {
  const root = document.createElement('div');
    renderSessionTracks(root, {
      payload: arrangementPayload,
      onStartAlias() {},
      onStartCreate() {},
    });
    const rows = collect(root, (node) => node.classList.contains('session-track'));
    const arrangement = rows.find((row) => collect(row, (node) => node.textContent === 'DECK A').length);
    const session = rows.find((row) => collect(row, (node) => node.textContent === 'DECK B').length);

    assert.deepEqual(buttonLabels(arrangement), []);
    assert.equal(arrangement.classList.contains('session-track--nomatch'), false);
    assert.equal(
      collect(arrangement, (node) => node.classList.contains('session-track-match--arrangement')).length,
      1
    );

    assert.deepEqual(buttonLabels(session), ['Add as alias', 'Add cue row']);
    assert.equal(session.classList.contains('session-track--nomatch'), true);
});
