// Compact session-log bar on the Set view. GET/PATCH /api/session-log — runtime, not config.json.

import { subscribeSessionLog } from './session-log-live.js';
import { mountSetNoteRow } from './moment-controls.js';

const SESSION_LOG_PARK_ID = 'session-log-park';

function isTextField(el) {
  if (el?.tagName === 'TEXTAREA') return true;
  if (el?.tagName !== 'INPUT') return false;
  const type = String(el.type ?? 'text').toLowerCase();
  return type === 'text' || type === 'search';
}

function readSelection(el) {
  try {
    return {
      start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
    };
  } catch {
    return { start: null, end: null };
  }
}

function focusIsIdle(doc) {
  const active = doc?.activeElement;
  return !active || active === doc.body || active === doc.documentElement;
}

/** True when the field is in the visible log bar, not the off-screen park. */
export function mountedFieldHostVisible(el) {
  if (!el?.isConnected) return false;
  let node = el;
  while (node) {
    if (node.id === SESSION_LOG_PARK_ID || node.hidden) return false;
    node = node.parentNode;
  }
  return true;
}

/**
 * Snapshot of a focused text field inside `root`.
 * @returns {{ el: Element, start: number|null, end: number|null } | null}
 */
export function captureMountedFieldFocus(root, doc) {
  const active = doc?.activeElement;
  if (!root || !active || !isTextField(active) || !root.contains(active)) return null;
  const selection = readSelection(active);
  return { el: active, ...selection };
}

/**
 * Put the caret back only if the operator has not focused something else.
 * @returns {boolean}
 */
export function restoreMountedFieldFocus(saved, doc) {
  if (!saved?.el || !mountedFieldHostVisible(saved.el) || !focusIsIdle(doc)) return false;
  saved.el.focus();
  if (typeof saved.start === 'number' && typeof saved.el.setSelectionRange === 'function') {
    try {
      saved.el.setSelectionRange(saved.start, saved.end ?? saved.start);
    } catch {
      // number and color inputs reject setSelectionRange
    }
  }
  return true;
}

/** In-document holder. Stays rendered so moving the note field does not blur it. */
export function ensureSessionLogPark(doc) {
  const existing = doc.getElementById(SESSION_LOG_PARK_ID);
  if (existing) return existing;
  const park = doc.createElement('div');
  park.id = SESSION_LOG_PARK_ID;
  park.className = 'session-log-park';
  park.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(park);
  return park;
}

/**
 * Move the log bar out of #app before a redraw.
 * On Set, leave it in #session-log — that host sits outside #app.
 * @returns {ReturnType<typeof captureMountedFieldFocus>}
 */
export function parkSessionLogForRender(mountEl, { viewId, doc }) {
  const focus = captureMountedFieldFocus(mountEl, doc);
  if (!mountEl) return focus;
  if (viewId === 'setlist') {
    const host = doc.getElementById('session-log');
    if (host?.contains(mountEl)) return focus;
  }
  const park = ensureSessionLogPark(doc);
  if (mountEl.parentNode !== park) park.appendChild(mountEl);
  return focus;
}

/** Put an existing log bar back in the Set host or the admin Set drawer. */
export function placeSessionLogMount(mountEl, { viewId, doc }) {
  if (!mountEl) return false;
  const targetId = viewId === 'setlist' ? 'session-log' : 'admin-set-log';
  const target = doc.getElementById(targetId);
  if (!target || mountEl.parentNode === target) return false;
  target.appendChild(mountEl);
  return true;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatShortTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** One-line status for the Set view log bar. */
export function formatSessionLogStatusLine(status) {
  const enabled = status?.enabled === true;
  const name = status?.sessionName ? `${status.sessionName}.jsonl` : null;
  if (!enabled) {
    return name ? `Logging off · ${name}` : 'Logging off';
  }
  const parts = [name || 'Logging on'];
  if (status.lineCount != null) parts.push(plural(status.lineCount, 'line'));
  if (status.momentCount != null) {
    const who = String(status.lastMoment?.who ?? '').trim();
    parts.push(who ? `${plural(status.momentCount, 'moment')} · ${who}` : plural(status.momentCount, 'moment'));
  }
  if (status.lastLoggedAt) parts.push(`last ${formatShortTime(status.lastLoggedAt)}`);
  return parts.join(' · ');
}

/** Keep a typed draft; only follow the server name if the field was still showing the last committed value. */
export function nextSessionNameInputValue({
  serverName,
  inputValue,
  lastCommittedName,
  always = false,
} = {}) {
  const committed = serverName || 'test';
  if (always || lastCommittedName == null || inputValue === lastCommittedName) {
    return committed;
  }
  return inputValue;
}

/** Insert (or reuse) a host above #app so setlist re-renders do not wipe the log bar. */
export function ensureSessionLogHost(app) {
  const doc = app?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  let host = doc?.getElementById?.('session-log');
  if (host) return { host, created: false };
  if (!doc?.createElement) return { host: null, created: false };

  host = doc.createElement('section');
  host.id = 'session-log';
  host.className = 'set-log';
  host.setAttribute('aria-label', 'Session log');

  const target = (app && typeof app.insertAdjacentElement === 'function')
    ? app
    : doc.getElementById?.('app');
  if (target && typeof target.insertAdjacentElement === 'function') {
    target.insertAdjacentElement('beforebegin', host);
  } else {
    const bar = doc.getElementById?.('status-bar');
    if (bar && typeof bar.insertAdjacentElement === 'function') {
      bar.insertAdjacentElement('afterend', host);
    } else {
      doc.body?.appendChild?.(host);
    }
  }
  return { host, created: true };
}

function showBanner(container, message) {
  const existing = container.querySelector('[data-role="session-log-banner"]');
  if (existing) existing.remove();
  if (!message) return;
  const banner = el('p', 'set-log-banner');
  banner.dataset.role = 'session-log-banner';
  banner.textContent = message;
  container.prepend(banner);
}

export function mountSessionLogPanel(selector, { getWho = () => 'setlist' } = {}) {
  const root = typeof selector === 'string'
    ? document.querySelector(selector)
    : selector;
  if (!root) return () => {};

  let status = null;
  let pollTimer = null;
  let unsubscribeLive = null;
  let built = false;
  let lastCommittedName = null;
  let toggle = null;
  let nameInput = null;
  let applyBtn = null;
  let statusLine = null;

  const shell = el('div', 'set-log-bar');
  root.appendChild(shell);
  mountSetNoteRow(root, { getWho });

  async function fetchStatus() {
    const res = await fetch('/api/session-log');
    if (!res.ok) throw new Error(`Session log status failed (${res.status})`);
    return res.json();
  }

  async function patchSessionLog(body) {
    const res = await fetch('/api/session-log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Patch failed (${res.status})`);
    return data;
  }

  function refreshStatusLine() {
    if (statusLine) statusLine.textContent = formatSessionLogStatusLine(status);
  }

  function buildShell() {
    const toggleLabel = el('label', 'set-log-toggle');
    toggle = el('input');
    toggle.type = 'checkbox';
    toggle.id = 'sessionLogEnabled';
    toggle.className = 'settings-checkbox';
    toggleLabel.appendChild(toggle);
    toggleLabel.appendChild(document.createTextNode('Log'));
    shell.appendChild(toggleLabel);

    nameInput = el('input', 'settings-input set-log-name');
    nameInput.type = 'text';
    nameInput.id = 'sessionLogName';
    nameInput.placeholder = 'Session name';
    nameInput.setAttribute('aria-label', 'Session name');
    nameInput.title = 'Changing the name starts a new .jsonl file';
    shell.appendChild(nameInput);

    applyBtn = el('button', 'admin-editor-btn admin-editor-btn--primary');
    applyBtn.type = 'button';
    applyBtn.textContent = 'Apply';
    applyBtn.title = 'Apply session name (also enables logging)';
    shell.appendChild(applyBtn);

    statusLine = el('p', 'set-log-status', formatSessionLogStatusLine(status));
    statusLine.dataset.role = 'session-log-status';
    shell.appendChild(statusLine);

    toggle.addEventListener('change', async () => {
      try {
        applyStatus(await patchSessionLog({ enabled: toggle.checked }));
        showBanner(shell, null);
      } catch (err) {
        toggle.checked = !toggle.checked;
        showBanner(shell, err.message);
      }
    });

    applyBtn.addEventListener('click', async () => {
      const sessionName = nameInput.value.trim();
      if (!sessionName) {
        showBanner(shell, 'Session name is required');
        return;
      }
      try {
        applyStatus(await patchSessionLog({ sessionName }), { alwaysSyncName: true });
        showBanner(shell, null);
      } catch (err) {
        showBanner(shell, err.message);
      }
    });
  }

  function applyStatus(nextStatus, { alwaysSyncName = false } = {}) {
    status = nextStatus;
    if (!built) {
      buildShell();
      built = true;
    } else {
      refreshStatusLine();
    }

    if (toggle) toggle.checked = status?.enabled === true;
    if (nameInput) {
      nameInput.value = nextSessionNameInputValue({
        serverName: status?.sessionName,
        inputValue: nameInput.value,
        lastCommittedName,
        always: alwaysSyncName,
      });
    }
    lastCommittedName = status?.sessionName || 'test';
  }

  async function refresh({ silent = false } = {}) {
    try {
      const next = await fetchStatus();
      try {
        const momentsRes = await fetch('/api/moments');
        if (momentsRes.ok) {
          const moments = await momentsRes.json();
          next.lastMoment = moments.lastMoment ?? null;
          next.momentCount = moments.momentCount ?? next.momentCount ?? 0;
        }
      } catch {
        // moments API optional during partial deploy
      }
      applyStatus(next);
      if (!silent) showBanner(shell, null);
    } catch (err) {
      if (!silent) showBanner(shell, err.message);
    }
  }

  function applyLiveSessionLog(sessionLog) {
    if (!sessionLog) return;
    applyStatus({
      ...(status ?? {}),
      enabled: sessionLog.enabled === true,
      sessionName: sessionLog.sessionName ?? status?.sessionName ?? 'test',
      lastLoggedAt: sessionLog.lastLoggedAt ?? status?.lastLoggedAt ?? null,
      momentCount: sessionLog.momentCount ?? status?.momentCount ?? 0,
      lastMoment: sessionLog.lastMoment !== undefined
        ? sessionLog.lastMoment
        : (status?.lastMoment ?? null),
    });
  }

  refresh();
  pollTimer = setInterval(() => refresh({ silent: true }), 5000);
  pollTimer.unref?.();
  unsubscribeLive = subscribeSessionLog(applyLiveSessionLog);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
    unsubscribeLive?.();
  };
}
