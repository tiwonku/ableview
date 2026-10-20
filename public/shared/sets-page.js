// Logged sets. A link from the Set page, not a view-nav tab.
// One session JSONL is one set. EDL download is a Resolve timeline-marker file.

import { withKioskQuery } from './kiosk-controls.js';
import {
  EDL_RATES,
  buildSessionEdl,
  dropFrameActive,
  edlRateById,
  sessionEdlDrafts,
} from './edl-markers.js';

const KIND_LABEL = { song: 'Song', dope: 'Dope', note: 'Note' };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function selectedName() {
  return new URLSearchParams(location.search).get('name')?.trim() || '';
}

function countPhrase(songs, dopes, notes, include) {
  const parts = [];
  if (include.songs) parts.push(songs === 1 ? '1 song' : `${songs} songs`);
  if (include.dopes) parts.push(dopes === 1 ? '1 dope' : `${dopes} dopes`);
  if (include.notes) parts.push(notes === 1 ? '1 note' : `${notes} notes`);
  return parts.join(' · ');
}

function rangeLabel(session) {
  if (session.firstTimestamp && session.lastTimestamp) {
    return `${session.firstTimestamp} – ${session.lastTimestamp}`;
  }
  if (session.modifiedAt) {
    const date = new Date(session.modifiedAt);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
  }
  return 'No stamps';
}

function tally(session) {
  const parts = [
    session.songCount === 1 ? '1 song' : `${session.songCount ?? 0} songs`,
    session.dopeCount === 1 ? '1 dope' : `${session.dopeCount ?? 0} dopes`,
  ];
  if (session.noteCount) {
    parts.push(session.noteCount === 1 ? '1 note' : `${session.noteCount} notes`);
  }
  return parts.join(' · ');
}

function noteTakers(moments) {
  const counts = new Map();
  for (const row of moments ?? []) {
    if (row.kind !== 'typed') continue;
    const who = String(row.who ?? '').trim();
    if (!who) continue;
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([who, count]) => ({ who, count }))
    .sort((a, b) => b.count - a.count || a.who.localeCompare(b.who));
}

function wireCrumbs(name) {
  const setLink = document.getElementById('sets-set-link');
  const indexLink = document.getElementById('sets-index-link');
  const current = document.getElementById('sets-current');
  if (setLink) setLink.href = withKioskQuery('/views/setlist');
  if (indexLink) indexLink.href = withKioskQuery('/views/sets');
  if (current) {
    current.hidden = !name;
    current.textContent = name ? ` / ${name}` : '';
  }
  document.title = name ? `AbleView — ${name}` : 'AbleView — Logged sets';
}

function renderList(root, sessions) {
  root.replaceChildren();
  const intro = el('p', 'sets-intro', 'Each logged session is one set. Open it to export a Resolve marker EDL.');
  root.appendChild(intro);
  if (!sessions.length) {
    root.appendChild(el('p', 'sets-empty', 'No logged sets yet. Turn on Log from the Set page.'));
    return;
  }
  const list = el('div', 'sets-list');
  for (const session of sessions) {
    const link = el('a', 'sets-row');
    link.href = withKioskQuery(`/views/sets?name=${encodeURIComponent(session.name)}`);
    const head = el('div', 'sets-row-head');
    head.appendChild(el('span', 'sets-row-name', session.name));
    if (session.logging) head.appendChild(el('span', 'sets-pill', 'Logging'));
    link.appendChild(head);
    link.appendChild(el('p', 'sets-row-meta', `${rangeLabel(session)} · ${tally(session)}`));
    list.appendChild(link);
  }
  root.appendChild(list);
}

function renderMarks(host, drafts, durations) {
  host.replaceChildren();
  if (!drafts.length) {
    host.appendChild(el('p', 'sets-empty', 'Nothing in this export.'));
    return;
  }
  const list = el('ol', 'sets-marks');
  for (const draft of drafts) {
    const item = el('li', `sets-mark sets-mark--${draft.kind}`);
    const time = el('span', 'sets-mark-time', draft.timestamp || '—');
    if (durations && draft.kind === 'song' && draft.endTimestamp) {
      time.textContent = `${draft.timestamp} – ${draft.endTimestamp}`;
    }
    item.appendChild(time);
    item.appendChild(el('span', 'sets-mark-kind', KIND_LABEL[draft.kind] ?? draft.kind));
    const body = el('div', 'sets-mark-body');
    body.appendChild(el('span', 'sets-mark-name', draft.name?.trim() || KIND_LABEL[draft.kind] || 'Mark'));
    if (draft.detail) body.appendChild(el('span', 'sets-mark-detail', draft.detail));
    item.appendChild(body);
    list.appendChild(item);
  }
  host.appendChild(list);
}

function renderDetail(root, summary) {
  root.replaceChildren();
  const rateId = summary.dropFrame ? '29.97' : '30';
  const state = {
    rateId,
    dropFrame: summary.dropFrame === true,
    durations: false,
    includeSongs: true,
    includeDopes: true,
    includeNotes: false,
    noteTaker: '',
    savedName: null,
  };

  const panel = el('section', 'sets-edl');
  panel.appendChild(el('h1', 'sets-title', summary.name));
  if (summary.logging) {
    panel.appendChild(el('p', 'sets-logging', 'This set is still logging. Export again after the show stops.'));
  }

  const controls = el('div', 'sets-edl-controls');
  const rateLabel = el('label', 'sets-field');
  rateLabel.appendChild(el('span', 'sets-field-label', 'Frame rate'));
  const rateSelect = el('select', 'settings-input');
  for (const rate of EDL_RATES) {
    const option = el('option', null, rate.id);
    option.value = rate.id;
    rateSelect.appendChild(option);
  }
  rateSelect.value = state.rateId;
  rateLabel.appendChild(rateSelect);
  controls.appendChild(rateLabel);

  const dropLabel = el('label', 'sets-check');
  const dropInput = el('input');
  dropInput.type = 'checkbox';
  dropLabel.appendChild(dropInput);
  dropLabel.appendChild(document.createTextNode('Drop frame'));
  controls.appendChild(dropLabel);

  const include = el('fieldset', 'sets-include');
  include.appendChild(el('legend', 'sets-field-label', 'Include'));
  const songsInput = checkbox(include, 'Setlist', true);
  const dopesInput = checkbox(include, 'Dopes', true);
  const notesInput = checkbox(include, 'Notes', false);
  controls.appendChild(include);

  const durationsLabel = el('label', 'sets-check');
  const durationsInput = el('input');
  durationsInput.type = 'checkbox';
  durationsLabel.appendChild(durationsInput);
  durationsLabel.appendChild(document.createTextNode('Durations'));
  controls.appendChild(durationsLabel);
  panel.appendChild(controls);

  const durationsHint = el(
    'p',
    'sets-hint',
    'With durations on, a song runs until the next song. Dopes and notes stay one frame.',
  );
  panel.appendChild(durationsHint);

  const takerWrap = el('div', 'sets-field sets-taker');
  takerWrap.appendChild(el('span', 'sets-field-label', 'Note taker'));
  const takerSelect = el('select', 'settings-input');
  const takers = noteTakers(summary.moments);
  takerSelect.appendChild(el('option', null, 'All'));
  takerSelect.firstChild.value = '';
  for (const taker of takers) {
    const option = el('option', null, `${taker.who} (${taker.count})`);
    option.value = taker.who;
    takerSelect.appendChild(option);
  }
  takerWrap.appendChild(takerSelect);
  panel.appendChild(takerWrap);

  const status = el('p', 'sets-status');
  panel.appendChild(status);
  const hint = el(
    'p',
    'sets-hint',
    'Times are the session clock. In Resolve, right-click the timeline in the Media Pool and choose Timelines → Import → Timeline Markers from EDL.',
  );
  panel.appendChild(hint);

  const download = el('button', 'admin-editor-btn admin-editor-btn--primary', 'Download EDL');
  download.type = 'button';
  panel.appendChild(download);
  const saved = el('p', 'sets-saved');
  saved.setAttribute('role', 'status');
  panel.appendChild(saved);
  root.appendChild(panel);

  const marks = el('div', 'sets-marks-host');
  root.appendChild(marks);

  function settings() {
    return {
      rateId: state.rateId,
      dropFrame: state.dropFrame,
      durations: state.durations,
    };
  }

  function refresh() {
    const rate = edlRateById(state.rateId);
    const fileDrop = summary.dropFrame === true;
    state.dropFrame = state.dropFrame && rate.dropAllowed && fileDrop;
    dropInput.checked = dropFrameActive(settings());
    dropInput.disabled = !(rate.dropAllowed && fileDrop);
    dropInput.title = fileDrop
      ? 'Session clock is drop-frame'
      : 'This log is stamped non-drop, so the file keeps those numbers';
    takerWrap.hidden = !state.includeNotes || takers.length === 0;
    const includeFlags = {
      songs: state.includeSongs,
      dopes: state.includeDopes,
      notes: state.includeNotes,
    };
    const drafts = sessionEdlDrafts({
      songs: summary.songs,
      moments: summary.moments,
      includeSongs: state.includeSongs,
      includeDopes: state.includeDopes,
      includeNotes: state.includeNotes,
      noteTaker: state.noteTaker,
      rateId: state.rateId,
    });
    const built = buildSessionEdl({
      songs: summary.songs,
      moments: summary.moments,
      includeSongs: state.includeSongs,
      includeDopes: state.includeDopes,
      includeNotes: state.includeNotes,
      noteTaker: state.noteTaker,
      settings: settings(),
      sessionName: summary.name,
    });
    const counts = built.ok
      ? countPhrase(built.songs, built.dopes, built.notes, includeFlags)
      : countPhrase(0, 0, 0, includeFlags);
    const rateLabelText = `${state.rateId} fps ${dropInput.checked ? 'drop-frame' : 'non-drop'}`;
    status.textContent = built.ok
      ? `${rateLabelText} · ${counts}${built.skipped ? ` · ${built.skipped} skipped` : ''}`
      : built.error;
    download.disabled = !built.ok;
    renderMarks(marks, drafts, state.durations);
    return built;
  }

  function touch() {
    state.savedName = null;
    saved.textContent = '';
    refresh();
  }

  rateSelect.addEventListener('change', () => {
    state.rateId = rateSelect.value;
    if (!edlRateById(state.rateId).dropAllowed) state.dropFrame = false;
    touch();
  });
  dropInput.addEventListener('change', () => {
    state.dropFrame = dropInput.checked;
    touch();
  });
  songsInput.addEventListener('change', () => {
    state.includeSongs = songsInput.checked;
    touch();
  });
  dopesInput.addEventListener('change', () => {
    state.includeDopes = dopesInput.checked;
    touch();
  });
  notesInput.addEventListener('change', () => {
    state.includeNotes = notesInput.checked;
    touch();
  });
  durationsInput.addEventListener('change', () => {
    state.durations = durationsInput.checked;
    touch();
  });
  takerSelect.addEventListener('change', () => {
    state.noteTaker = takerSelect.value;
    touch();
  });
  download.addEventListener('click', () => {
    const built = refresh();
    if (!built.ok) return;
    const filename = `${summary.name}-markers.edl`;
    const blob = new Blob([built.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    state.savedName = filename;
    saved.textContent = `Saved ${filename}.`;
  });

  refresh();
}

function checkbox(host, label, checked) {
  const wrap = el('label', 'sets-check');
  const input = el('input');
  input.type = 'checkbox';
  input.checked = checked;
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(label));
  host.appendChild(wrap);
  return input;
}

export function mountSetsPage(root) {
  if (!root) return;
  const name = selectedName();
  wireCrumbs(name);
  root.replaceChildren(el('p', 'sets-status', 'Loading…'));
  if (!name) {
    fetch('/api/sessions')
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Could not list sets (${res.status})`);
        renderList(root, body.sessions ?? []);
      })
      .catch((err) => {
        root.replaceChildren(el('p', 'sets-error', err.message));
      });
    return;
  }
  fetch(`/api/sessions/${encodeURIComponent(name)}`)
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Could not open this set (${res.status})`);
      renderDetail(root, body);
    })
    .catch((err) => {
      root.replaceChildren(el('p', 'sets-error', err.message));
    });
}
