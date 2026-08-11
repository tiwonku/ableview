// Session log panel (M10). GET/PATCH /api/session-log — separate from config.json settings.

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
    box.appendChild(el('p', 'ableton-session-line', `Last entry: ${formatTime(status.lastLoggedAt)}`));
  } else if (status?.sessionName) {
    box.appendChild(el('p', 'ableton-session-line', `Session name: ${status.sessionName}`));
  }

  return box;
}

export function mountSessionLogPanel(selector) {
  const root = document.querySelector(selector);
  if (!root) return;

  let status = null;
  let pollTimer = null;

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

  function render() {
    shell.replaceChildren();

    shell.appendChild(el('h2', 'settings-page-title', 'Session log'));
    shell.appendChild(el(
      'p',
      'settings-lead',
      'Append-only JSONL of watched-track clip changes and sheet match events. Files live under data/sessions/ (not in git).',
    ));

    const fieldset = el('fieldset', 'settings-group session-log-group');
    fieldset.appendChild(el('legend', null, 'Session log'));
    fieldset.appendChild(renderStatusBox(status));

    const toggle = el('input');
    toggle.type = 'checkbox';
    toggle.id = 'sessionLogEnabled';
    toggle.className = 'settings-checkbox';
    toggle.checked = status?.enabled === true;

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
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.className = 'settings-input';
    nameInput.id = 'sessionLogName';
    nameInput.value = status?.sessionName ?? 'test';
    nameInput.placeholder = 'Session name';
    const applyBtn = el('button', 'settings-sync', 'Apply session name');
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
        status = await patchSessionLog({ enabled: toggle.checked });
        render();
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
        status = await patchSessionLog({ sessionName });
        render();
        showBanner(shell, `Logging to ${status.sessionName}.jsonl`);
      } catch (err) {
        showBanner(shell, err.message, { error: true });
      }
    });
  }

  async function refresh({ silent = false } = {}) {
    try {
      status = await fetchStatus();
      render();
      if (!silent) showBanner(shell, null);
    } catch (err) {
      if (!silent) showBanner(shell, err.message, { error: true });
    }
  }

  refresh();
  pollTimer = setInterval(() => refresh({ silent: true }), 5000);

  return () => {
    if (pollTimer) clearInterval(pollTimer);
  };
}
