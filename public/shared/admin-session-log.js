// Session log panel (M10). GET/PATCH /api/session-log — separate from config.json settings.

import { subscribeSessionLog } from './session-log-live.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function showBanner(container, message, { error = false } = {}) {
  const existing = container.querySelector('[data-role="session-log-banner"]');
  if (existing) existing.remove();
  if (!message) return;
  const banner = el('div', `settings-status ${error ? 'err' : 'ok'}`);
  banner.dataset.role = 'session-log-banner';
  banner.textContent = message;
  container.prepend(banner);
}

function renderStatusBox(status) {
  const box = el('div', 'session-log-status');
  box.dataset.role = 'session-log-status';

  const enabled = status?.enabled === true;
  box.appendChild(el('p', 'ableton-session-line', enabled ? 'Logging enabled' : 'Logging disabled'));

  if (enabled && status.filePath) {
    box.appendChild(el('p', 'ableton-session-line', `File: ${status.filePath}`));
    box.appendChild(el('p', 'ableton-session-line', `Lines: ${status.lineCount ?? 0}`));
    box.appendChild(el('p', 'ableton-session-line', `Moments this session: ${status.momentCount ?? 0}`));
    box.appendChild(el('p', 'ableton-session-line', `Last entry: ${formatTime(status.lastLoggedAt)}`));
    if (status.lastMoment) {
      const who = status.lastMoment.who ? ` (${status.lastMoment.who})` : '';
      box.appendChild(el(
        'p',
        'ableton-session-line',
        `Last moment: ${status.lastMoment.kind}${who} at ${formatTime(status.lastMoment.loggedAt)}`,
      ));
    }
    const summary = status.launchSummary;
    if (summary && (summary.totalLaunches ?? 0) > 0) {
      const sceneCount = summary.sceneLaunches ?? 0;
      const clipCount = summary.clipLaunches ?? 0;
      const total = summary.totalLaunches ?? sceneCount + clipCount;
      const scenePct = total > 0 ? Math.round((sceneCount / total) * 100) : 0;
      box.appendChild(el(
        'p',
        'ableton-session-line',
        `Launches: ${total} (${sceneCount} scene, ${clipCount} clip · ${scenePct}% scenes)`,
      ));
    }
  } else if (status?.sessionName) {
    box.appendChild(el('p', 'ableton-session-line', `Session name: ${status.sessionName}`));
  }

  return box;
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

export function mountSessionLogPanel(selector) {
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

  const shell = el('div', 'session-log-panel');
  root.appendChild(shell);

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

  function refreshStatusBox() {
    const next = renderStatusBox(status);
    const existing = shell.querySelector('[data-role="session-log-status"]');
    if (existing) existing.replaceWith(next);
  }

  function buildShell() {
    shell.appendChild(el('h2', 'settings-page-title', 'Session log'));
    shell.appendChild(el(
      'p',
      'settings-lead',
      'Append-only JSONL of watched-track clip changes, scene/clip launch events, and sheet match events. Files live under data/sessions/ and are committed so other machines can pull them. The active-session sidecar stays local.',
    ));

    const fieldset = el('fieldset', 'settings-group session-log-group');
    fieldset.appendChild(el('legend', null, 'Session log'));
    fieldset.appendChild(renderStatusBox(status));

    toggle = el('input');
    toggle.type = 'checkbox';
    toggle.id = 'sessionLogEnabled';
    toggle.className = 'settings-checkbox';

    const toggleRow = el('div', 'settings-field settings-field-checkbox');
    toggleRow.appendChild(toggle);
    const toggleLabel = el('label', 'settings-checkbox-label', 'Enable logging');
    toggleLabel.htmlFor = 'sessionLogEnabled';
    toggleRow.appendChild(toggleLabel);
    fieldset.appendChild(toggleRow);

    const nameField = el('div', 'settings-field settings-field-stacked session-log-name-field');
    const nameLabel = el('label', 'settings-label', 'Session name');
    nameLabel.htmlFor = 'sessionLogName';
    nameField.appendChild(nameLabel);

    const nameRow = el('div', 'session-log-name-row');
    nameInput = el('input');
    nameInput.type = 'text';
    nameInput.className = 'settings-input';
    nameInput.id = 'sessionLogName';
    nameInput.placeholder = 'Session name';
    applyBtn = el('button', 'settings-sync', 'Apply session name');
    applyBtn.type = 'button';
    nameRow.append(nameInput, applyBtn);
    nameField.appendChild(nameRow);
    fieldset.appendChild(nameField);

    fieldset.appendChild(el(
      'p',
      'settings-hint session-log-hint',
      'Changing the session name starts a new .jsonl file. Applying a name also enables logging. Timestamps use Art-Net SMPTE when live, otherwise local clock.',
    ));

    shell.appendChild(fieldset);

    toggle.addEventListener('change', async () => {
      try {
        applyStatus(await patchSessionLog({ enabled: toggle.checked }));
        showBanner(shell, toggle.checked ? 'Session logging enabled' : 'Session logging disabled');
      } catch (err) {
        toggle.checked = !toggle.checked;
        showBanner(shell, err.message, { error: true });
      }
    });

    applyBtn.addEventListener('click', async () => {
      const sessionName = nameInput.value.trim();
      if (!sessionName) {
        showBanner(shell, 'Session name is required', { error: true });
        return;
      }
      try {
        applyStatus(await patchSessionLog({ sessionName }), { alwaysSyncName: true });
        showBanner(shell, `Logging to ${status.sessionName}.jsonl`);
      } catch (err) {
        showBanner(shell, err.message, { error: true });
      }
    });
  }

  function applyStatus(nextStatus, { alwaysSyncName = false } = {}) {
    status = nextStatus;
    if (!built) {
      buildShell();
      built = true;
    } else {
      refreshStatusBox();
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
      if (!silent) showBanner(shell, err.message, { error: true });
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
