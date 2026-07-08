// Shared view rendering (spec §9.4). Maps CuePayload + field config → DOM.

export function renderView(root, { title, fields, payload, connected, lastUpdate }) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'View';
  root.appendChild(titleEl);

  const clipName = payload?.clipName?.trim() || null;
  const clipEl = document.createElement('p');
  clipEl.className = 'clip-name';
  if (clipName) {
    clipEl.textContent = clipName;
  } else {
    clipEl.className += ' empty-clip';
    clipEl.textContent = 'Nothing playing';
  }
  root.appendChild(clipEl);

  const matched = payload?.match?.matched === true;
  if (payload && clipName && !matched) {
    const noMatch = document.createElement('div');
    noMatch.className = 'no-match';
    noMatch.textContent = 'No confident match — check the cue sheet or clip name.';
    root.appendChild(noMatch);
  }

  if (matched && fields?.length) {
    const grid = document.createElement('div');
    grid.className = 'fields';
    for (const field of fields) {
      const column = field.column;
      const label = field.label ?? column;
      const raw = payload.row?.[column];
      const value = raw == null || String(raw).trim() === '' ? null : String(raw);

      const card = document.createElement('div');
      card.className = 'field';

      const labelEl = document.createElement('p');
      labelEl.className = 'field-label';
      labelEl.textContent = label;
      card.appendChild(labelEl);

      const valueEl = document.createElement('p');
      valueEl.className = 'field-value' + (value ? '' : ' empty');
      valueEl.textContent = value ?? '—';
      card.appendChild(valueEl);

      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

function updateStatusBar({ connected, lastUpdate, payload }) {
  const bar = document.getElementById('status-bar');
  if (!bar) return;

  bar.classList.toggle('connected', connected);

  const connText = bar.querySelector('[data-role="connection"]');
  if (connText) connText.textContent = connected ? 'Connected' : 'Reconnecting…';

  const updateText = bar.querySelector('[data-role="last-update"]');
  if (updateText) {
    updateText.textContent = lastUpdate
      ? `Last update: ${lastUpdate.toLocaleTimeString()}`
      : 'Last update: —';
  }

  const simBanner = document.getElementById('sim-banner');
  if (simBanner) simBanner.hidden = !payload?.simulated;

  const staleBanner = document.getElementById('stale-banner');
  if (staleBanner) staleBanner.hidden = !payload?.stale;
}

export function setConnectionState(connected, lastUpdate, payload) {
  updateStatusBar({ connected, lastUpdate, payload });
}
