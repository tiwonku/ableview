// Shared view rendering (spec §9.4). Maps CuePayload + field config → DOM.

import { parseRgbCell } from './color-parse.js';

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

    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (field.type === 'color') {
        const group = [];
        while (i < fields.length && fields[i].type === 'color') {
          group.push(fields[i]);
          i++;
        }
        i--;
        grid.appendChild(renderColorGroup(group, payload));
      } else {
        grid.appendChild(renderTextField(field, payload));
      }
    }

    root.appendChild(grid);
  }

  updateStatusBar({ connected, lastUpdate, payload });
}

function renderTextField(field, payload) {
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

  return card;
}

function renderColorGroup(fields, payload) {
  const row = document.createElement('div');
  row.className = 'colors-row';

  for (const field of fields) {
    row.appendChild(renderColorField(field, payload));
  }

  return row;
}

function renderColorField(field, payload) {
  const column = field.column;
  const label = field.label ?? column;
  const raw = payload.row?.[column];
  const color = parseRgbCell(raw);

  const card = document.createElement('div');
  card.className = 'field field-color';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  if (!color) {
    const empty = document.createElement('p');
    empty.className = 'field-value empty';
    empty.textContent = '—';
    card.appendChild(empty);
    return card;
  }

  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  swatch.style.backgroundColor = color.css;
  swatch.setAttribute('aria-label', `${label}: ${color.rgbText}`);
  card.appendChild(swatch);

  const values = document.createElement('div');
  values.className = 'color-values';
  values.appendChild(makeCopyButton('RGB', color.rgbText));
  values.appendChild(makeCopyButton('Hex', color.hex));
  card.appendChild(values);

  return card;
}

function makeCopyButton(kind, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'color-copy';
  btn.title = `Copy ${kind}`;

  const kindEl = document.createElement('span');
  kindEl.className = 'color-copy-kind';
  kindEl.textContent = kind;
  btn.appendChild(kindEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'color-copy-value';
  valueEl.textContent = text;
  btn.appendChild(valueEl);

  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      window.setTimeout(() => btn.classList.remove('copied'), 1200);
    } catch {
      btn.classList.add('copy-failed');
      window.setTimeout(() => btn.classList.remove('copy-failed'), 1200);
    }
  });

  return btn;
}

function updateStatusBar({ connected, lastUpdate, payload }) {
  const bar = document.getElementById('status-bar');
  if (!bar) return;

  bar.classList.toggle('connected', connected);

  const connText = bar.querySelector('[data-role="connection"]');
  if (connText) connText.textContent = connected ? 'Connected' : 'Reconnecting…';

  const updateText = bar.querySelector('[data-role="last-update"]');
  if (updateText) {
    if (lastUpdate) {
      updateText.textContent = lastUpdate.toLocaleTimeString();
      updateText.title = `Last cue update: ${lastUpdate.toLocaleString()}`;
    } else {
      updateText.textContent = '—';
      updateText.title = 'Last cue update';
    }
  }

  const simPill = document.getElementById('sim-pill');
  const stalePill = document.getElementById('stale-pill');
  const simOn = Boolean(payload?.simulated);
  const staleOn = Boolean(payload?.stale);
  if (simPill) simPill.hidden = !simOn;
  if (stalePill) stalePill.hidden = !staleOn;
  bar.classList.toggle('status-bar--alert', simOn || staleOn);
}

export function setConnectionState(connected, lastUpdate, payload) {
  updateStatusBar({ connected, lastUpdate, payload });
}

function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return '—';
  return `${Math.round(confidence * 100)}%`;
}

function formatTempo(tempo) {
  if (tempo == null || Number.isNaN(Number(tempo))) return '—';
  const n = Number(tempo);
  return Number.isInteger(n) ? `${n} BPM` : `${n.toFixed(1)} BPM`;
}

function formatBeat(beat) {
  if (beat == null || Number.isNaN(Number(beat))) return '—';
  return String(beat);
}

function addStat(parent, label, value, { warn = false } = {}) {
  const card = document.createElement('div');
  card.className = 'stat' + (warn ? ' warn' : '');

  const labelEl = document.createElement('p');
  labelEl.className = 'stat-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement('p');
  valueEl.className = 'stat-value';
  valueEl.textContent = value ?? '—';
  card.appendChild(valueEl);

  parent.appendChild(card);
}

export function renderAdmin(root, { title, payload, status, connected, lastUpdate }) {
  root.innerHTML = '';

  const titleEl = document.createElement('h1');
  titleEl.className = 'view-title';
  titleEl.textContent = title ?? 'Admin';
  root.appendChild(titleEl);

  const clipName = payload?.clipName?.trim() || null;
  const clipEl = document.createElement('p');
  clipEl.className = 'clip-name' + (clipName ? '' : ' empty-clip');
  clipEl.textContent = clipName ?? 'Nothing playing';
  root.appendChild(clipEl);

  const stats = document.createElement('div');
  stats.className = 'admin-stats';

  const matched = payload?.match?.matched === true;
  addStat(stats, 'Match', matched ? 'Yes' : 'No', { warn: payload && clipName && !matched });
  addStat(stats, 'Confidence', formatConfidence(payload?.match?.confidence));
  addStat(stats, 'Row ID', payload?.match?.rowId ?? '—');
  addStat(stats, 'Matched value', payload?.match?.matchedValue ?? '—');
  addStat(stats, 'Via alias', payload?.match?.viaAlias ? 'Yes' : 'No');
  addStat(stats, 'Tempo', formatTempo(payload?.tempo));
  addStat(stats, 'Beat', formatBeat(payload?.beat));
  addStat(stats, 'Last sync', formatTimestamp(payload?.syncedAt));
  addStat(stats, 'Cache', payload?.stale ? 'Stale (offline)' : 'Fresh', { warn: payload?.stale });
  addStat(stats, 'Connected views', String(status?.connectedViews ?? 0));

  root.appendChild(stats);

  if (payload && clipName && !matched) {
    const noMatch = document.createElement('div');
    noMatch.className = 'no-match';
    noMatch.textContent = 'No confident match — check the cue sheet or clip name.';
    root.appendChild(noMatch);
  }

  if (matched && payload.row) {
    const section = document.createElement('section');
    section.className = 'admin-section';

    const heading = document.createElement('h2');
    heading.className = 'section-title';
    heading.textContent = 'Matched row';
    section.appendChild(heading);

    const table = document.createElement('dl');
    table.className = 'row-table';
    for (const [column, raw] of Object.entries(payload.row)) {
      const value = raw == null || String(raw).trim() === '' ? '—' : String(raw);

      const dt = document.createElement('dt');
      dt.textContent = column;
      table.appendChild(dt);

      const dd = document.createElement('dd');
      dd.textContent = value;
      table.appendChild(dd);
    }
    section.appendChild(table);
    root.appendChild(section);
  }

  updateStatusBar({ connected, lastUpdate, payload });
}
