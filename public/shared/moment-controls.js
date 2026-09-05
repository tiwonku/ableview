/** Browser client for POST /api/moments (dope + typed). Companion uses the same API. */

export const MOMENT_FEEDBACK_MS = 1000;

export const FEEDBACK_CLASSES = Object.freeze({
  pending: 'moment-feedback--pending',
  success: 'moment-feedback--success',
  warning: 'moment-feedback--warning',
  error: 'moment-feedback--error',
});

export function feedbackStateFromResponse(status, body) {
  if (body?.feedbackState) return body.feedbackState;
  if (status === 429) return 'warning';
  if (status >= 200 && status < 300 && body?.ok !== false) return 'success';
  return 'error';
}

export async function postMoment({ kind = 'dope', who = null, note = null } = {}, fetchFn = fetch) {
  try {
    const res = await fetchFn('/api/moments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, who, note }),
    });
    const data = await res.json().catch(() => ({}));
    const feedbackState = feedbackStateFromResponse(res.status, data);
    return {
      ok: res.ok && data.ok !== false,
      status: res.status,
      feedbackState,
      ...data,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      feedbackState: 'error',
      error: 'network',
      message: err?.message ?? 'Network error',
    };
  }
}

export function applyMomentFeedback(el, state) {
  if (!el) return;
  const classes = Object.values(FEEDBACK_CLASSES);
  el.classList.remove(...classes);
  const cls = FEEDBACK_CLASSES[state];
  if (cls) el.classList.add(cls);
  el.disabled = state === 'pending';
}

export function bindMomentFeedback(el, { flashMs = MOMENT_FEEDBACK_MS } = {}) {
  let timer = null;
  return {
    set(state) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      applyMomentFeedback(el, state);
      if (state && state !== 'pending') {
        timer = setTimeout(() => {
          applyMomentFeedback(el, null);
          timer = null;
        }, flashMs);
      }
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      applyMomentFeedback(el, null);
    },
  };
}

function resolveWho(getWho) {
  return typeof getWho === 'function' ? getWho() : (getWho ?? null);
}

export async function pressMoment(feedback, payload, post = postMoment) {
  feedback.set('pending');
  const result = await post(payload);
  feedback.set(result.feedbackState);
  return result;
}

let liveGetWho = null;
let sharedDopeButton = null;

export function setMomentWhoGetter(getWho) {
  liveGetWho = getWho;
}

export function currentMomentWho() {
  return resolveWho(liveGetWho);
}

export function createDopeButton({ getWho, className = 'view-edit-btn view-edit-btn--dope' } = {}) {
  if (getWho != null) liveGetWho = getWho;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = 'Dope';
  btn.dataset.role = 'moment-dope';
  btn.title = 'Mark a dope moment';
  const feedback = bindMomentFeedback(btn);
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    pressMoment(feedback, { kind: 'dope', who: currentMomentWho() });
  });
  return btn;
}

export function prependDopeButton(parent, getWho) {
  if (!parent || (typeof getWho !== 'function' && getWho == null)) return null;
  liveGetWho = getWho;
  if (!sharedDopeButton) {
    sharedDopeButton = createDopeButton();
  }
  parent.insertBefore(sharedDopeButton, parent.firstChild);
  return sharedDopeButton;
}

export function mountSetNoteRow(host, { getWho } = {}) {
  if (!host) return null;
  let row = host.querySelector('[data-role="set-note-bar"]');
  if (row) return row;

  row = document.createElement('div');
  row.className = 'set-note-bar';
  row.dataset.role = 'set-note-bar';

  const label = document.createElement('label');
  label.className = 'set-note-label';
  label.htmlFor = 'setNoteInput';
  label.textContent = 'Note';

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'setNoteInput';
  input.className = 'settings-input set-note-input';
  input.maxLength = 200;
  input.placeholder = 'Type a moment…';
  input.setAttribute('aria-label', 'Moment note');
  input.autocomplete = 'off';

  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'view-edit-btn view-edit-btn--dope';
  send.textContent = 'Send';
  send.dataset.role = 'moment-note-send';
  const feedback = bindMomentFeedback(send);

  async function submit() {
    const note = input.value.trim();
    if (!note || send.disabled) return;
    const result = await pressMoment(feedback, {
      kind: 'typed',
      who: resolveWho(getWho) ?? 'setlist',
      note,
    });
    if (result.ok) input.value = '';
  }

  send.addEventListener('click', () => { submit(); });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    }
  });

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(send);
  host.appendChild(row);
  return row;
}
