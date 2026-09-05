import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_CLASSES,
  applyMomentFeedback,
  currentMomentWho,
  feedbackStateFromResponse,
  postMoment,
  pressMoment,
  setMomentWhoGetter,
} from '../public/shared/moment-controls.js';

function mockEl() {
  const classes = new Set();
  return {
    disabled: false,
    classList: {
      add: (name) => { classes.add(name); },
      remove: (...names) => { names.forEach((name) => classes.delete(name)); },
    },
    has: (name) => classes.has(name),
  };
}

test('feedbackStateFromResponse maps Companion-style states', () => {
  assert.equal(feedbackStateFromResponse(200, { ok: true, feedbackState: 'success' }), 'success');
  assert.equal(feedbackStateFromResponse(429, { error: 'debounced' }), 'warning');
  assert.equal(feedbackStateFromResponse(400, { error: 'note_required' }), 'error');
  assert.equal(feedbackStateFromResponse(409, { feedbackState: 'error' }), 'error');
  assert.equal(feedbackStateFromResponse(0, {}), 'error');
});

test('applyMomentFeedback swaps classes and disables while pending', () => {
  const el = mockEl();
  applyMomentFeedback(el, 'pending');
  assert.equal(el.disabled, true);
  assert.equal(el.has(FEEDBACK_CLASSES.pending), true);

  applyMomentFeedback(el, 'success');
  assert.equal(el.disabled, false);
  assert.equal(el.has(FEEDBACK_CLASSES.pending), false);
  assert.equal(el.has(FEEDBACK_CLASSES.success), true);

  applyMomentFeedback(el, 'error');
  assert.equal(el.has(FEEDBACK_CLASSES.success), false);
  assert.equal(el.has(FEEDBACK_CLASSES.error), true);

  applyMomentFeedback(el, null);
  assert.equal(el.has(FEEDBACK_CLASSES.error), false);
});

test('postMoment sends kind/who/note and returns feedbackState', async () => {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, feedbackState: 'success', kind: 'dope', who: 'visuals' }),
    };
  };
  const result = await postMoment({ kind: 'dope', who: 'visuals' }, fetchFn);
  assert.equal(result.ok, true);
  assert.equal(result.feedbackState, 'success');
  assert.equal(calls[0].url, '/api/moments');
  assert.equal(JSON.parse(calls[0].opts.body).who, 'visuals');
});

test('postMoment maps 429 and network failure', async () => {
  const warn = await postMoment({ kind: 'dope', who: 'band' }, async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: 'debounced' }),
  }));
  assert.equal(warn.ok, false);
  assert.equal(warn.feedbackState, 'warning');

  const down = await postMoment({ kind: 'dope' }, async () => {
    throw new Error('offline');
  });
  assert.equal(down.ok, false);
  assert.equal(down.feedbackState, 'error');
  assert.equal(down.error, 'network');
});

test('currentMomentWho reads a live getter without wrapping itself', () => {
  setMomentWhoGetter(() => 'visuals');
  assert.equal(currentMomentWho(), 'visuals');
  setMomentWhoGetter(null);
  assert.equal(currentMomentWho(), null);
});

test('pressMoment sets pending then the response state', async () => {
  const states = [];
  const feedback = { set: (state) => { states.push(state); } };
  const result = await pressMoment(
    feedback,
    { kind: 'typed', who: 'setlist', note: 'wow' },
    async (payload) => {
      assert.equal(payload.kind, 'typed');
      return { ok: true, feedbackState: 'success' };
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(states, ['pending', 'success']);
});
