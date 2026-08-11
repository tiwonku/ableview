// Session view: watched tracks + per-track match confidence.

import { setConnectionState } from './view-render.js';

function trackRows(payload) {
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  return [...tracks].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
}

function matchForTrack(payload, track) {
  const list = Array.isArray(payload?.trackMatches) ? payload.trackMatches : [];
  return list.find(
    (m) =>
      m.trackIndex === track.trackIndex
      || (m.trackName && track.trackName && m.trackName === track.trackName)
  ) ?? null;
}

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return '0%';
  return `${Math.round(confidence * 100)}%`;
}

/**
 * @param {HTMLElement} root
 * @param {{ title?: string, payload?: object|null, connected?: boolean, lastUpdate?: Date|null }} ctx
 */
export function renderSession(root, ctx) {
  const { title, payload, connected, lastUpdate } = ctx;
  setConnectionState(connected, lastUpdate, payload);

  root.replaceChildren();
  root.className = 'session-main';

  const heading = document.createElement('h1');
  heading.className = 'view-title';
  heading.textContent = title || 'Session';
  root.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'session-tracks';
  list.setAttribute('role', 'list');

  const rows = trackRows(payload);
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'session-empty';
    empty.textContent = payload
      ? 'No watched tracks reporting yet.'
      : 'Waiting for session…';
    list.appendChild(empty);
  } else {
    for (const track of rows) {
      const row = document.createElement('div');
      row.className = 'session-track';
      row.setAttribute('role', 'listitem');

      const playing = Boolean(track.clipName?.trim());
      const tm = matchForTrack(payload, track);

      if (playing) row.classList.add('session-track--playing');
      if (tm?.winner) row.classList.add('session-track--winner');
      else if (tm?.matched) row.classList.add('session-track--matched');
      else if (playing) row.classList.add('session-track--nomatch');

      const meta = document.createElement('div');
      meta.className = 'session-track-meta';

      const name = document.createElement('div');
      name.className = 'session-track-name';
      name.textContent = track.trackName || `Track ${track.trackIndex}`;
      meta.appendChild(name);

      const index = document.createElement('div');
      index.className = 'session-track-index';
      index.textContent =
        track.trackIndex == null ? '' : `Track ${track.trackIndex}`;
      meta.appendChild(index);

      const matchLine = document.createElement('div');
      matchLine.className = 'session-track-match';
      if (!playing) {
        matchLine.textContent = '—';
        matchLine.classList.add('session-track-match--empty');
      } else if (tm?.matched) {
        const conf = formatConfidence(tm.confidence);
        const label = tm.matchedValue || 'matched';
        matchLine.textContent = tm.winner
          ? `Winner · ${conf} · ${label}`
          : `Match · ${conf} · ${label}`;
        if (tm.winner) matchLine.classList.add('session-track-match--winner');
        else matchLine.classList.add('session-track-match--ok');
      } else {
        matchLine.textContent = 'No match';
        matchLine.classList.add('session-track-match--none');
      }
      meta.appendChild(matchLine);

      const clip = document.createElement('div');
      clip.className = 'session-track-clip' + (playing ? '' : ' session-track-clip--empty');

      if (playing) {
        const clipText = document.createElement('span');
        clipText.className = 'session-track-clip-name';
        clipText.textContent = track.clipName;
        clip.appendChild(clipText);

        if (track.slotIndex != null && track.slotIndex >= 0) {
          const slot = document.createElement('span');
          slot.className = 'session-track-slot';
          slot.textContent = `Slot ${track.slotIndex + 1}`;
          clip.appendChild(slot);
        }
      } else {
        clip.textContent = '—';
      }

      row.appendChild(meta);
      row.appendChild(clip);
      list.appendChild(row);
    }
  }

  root.appendChild(list);
}
