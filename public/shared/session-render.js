// Session view: watched tracks + currently playing clip names (v1).

import { setConnectionState } from './view-render.js';

function trackRows(payload) {
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  return [...tracks].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
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
      if (playing) row.classList.add('session-track--playing');
      if (
        playing
        && payload?.clipName
        && track.clipName === payload.clipName
      ) {
        row.classList.add('session-track--cue');
      }

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
