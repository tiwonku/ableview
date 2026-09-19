// Session track grid + scene banner. Shared by Session view and admin board.

import {
  matchForTrack,
  isAliasTargetTrack,
  isCreateTargetTrack,
  isArrangementTrack,
} from './playing-clips-strip.js';

function trackRows(payload) {
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  return [...tracks].sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
}

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return '0%';
  return `${Math.round(confidence * 100)}%`;
}

export function formatSceneBanner(scene, payload) {
  if (!scene?.launchType || scene.index == null) return null;

  const slotLabel = `Row ${scene.index + 1}`;
  const pending = scene.pending || payload?.pendingLaunch;
  const pendingTag = pending ? ' · launching' : '';

  if (scene.launchType === 'scene') {
    const name = scene.name?.trim();
    const title = name ? `"${name}"` : slotLabel;
    return {
      kind: 'scene',
      primary: `Scene ${title}${pendingTag}`,
      secondary: name ? slotLabel : null,
    };
  }

  const track = scene.trackName || (scene.trackIndex != null ? `Track ${scene.trackIndex}` : 'Track');
  return {
    kind: 'clip',
    primary: `Clip launch · ${track}${pendingTag}`,
    secondary: slotLabel,
  };
}

export function renderSceneBanner(parent, payload) {
  const sceneBanner = formatSceneBanner(payload?.scene, payload);
  if (!sceneBanner) return null;

  const banner = document.createElement('div');
  banner.className = `session-scene-banner session-scene-banner--${sceneBanner.kind}`;
  if (sceneBanner.pending || payload?.pendingLaunch) {
    banner.classList.add('session-scene-banner--pending');
  }
  const primary = document.createElement('div');
  primary.className = 'session-scene-banner-primary';
  primary.textContent = sceneBanner.primary;
  banner.appendChild(primary);
  if (sceneBanner.secondary) {
    const secondary = document.createElement('div');
    secondary.className = 'session-scene-banner-secondary';
    secondary.textContent = sceneBanner.secondary;
    banner.appendChild(secondary);
  }
  parent.appendChild(banner);
  return banner;
}

export function renderSessionTracks(parent, {
  payload,
  aliasSession = null,
  editSession = null,
  onStartAlias,
  onStartCreate,
  compact = false,
} = {}) {
  const createSession = editSession?.mode === 'create' ? editSession : null;
  const busy = Boolean(aliasSession || editSession);

  const list = document.createElement('div');
  list.className = 'session-tracks' + (compact ? ' session-tracks--compact' : '');
  list.setAttribute('role', 'list');

  const rows = trackRows(payload);
  list.style.setProperty(
    '--session-track-count',
    String(rows.length > 0 ? Math.min(6, rows.length) : 6),
  );
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
      const aliasTarget = isAliasTargetTrack(aliasSession, track);
      const createTarget = isCreateTargetTrack(createSession, track);

      if (playing) row.classList.add('session-track--playing');
      if (isArrangementTrack(track)) row.classList.add('session-track--arrangement');
      if (aliasTarget) row.classList.add('session-track--alias-target');
      else if (createTarget) row.classList.add('session-track--create-target');
      else if (tm?.winner) row.classList.add('session-track--winner');
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

      if (playing && !tm?.matched && !busy && (onStartAlias || onStartCreate)) {
        const actions = document.createElement('div');
        actions.className = 'session-track-actions';

        if (onStartAlias) {
          const aliasBtn = document.createElement('button');
          aliasBtn.type = 'button';
          aliasBtn.className = 'session-track-alias-btn';
          aliasBtn.textContent = 'Add as alias';
          aliasBtn.addEventListener('click', () => onStartAlias(track.clipName, track));
          actions.appendChild(aliasBtn);
        }

        if (onStartCreate) {
          const createBtn = document.createElement('button');
          createBtn.type = 'button';
          createBtn.className = 'session-track-create-btn';
          createBtn.textContent = 'Add cue row';
          createBtn.addEventListener('click', () => onStartCreate(track.clipName, track));
          actions.appendChild(createBtn);
        }

        meta.appendChild(actions);
      }

      const clip = document.createElement('div');
      clip.className = 'session-track-clip' + (playing ? '' : ' session-track-clip--empty');

      if (playing) {
        const clipText = document.createElement('span');
        clipText.className = 'session-track-clip-name';
        clipText.textContent = track.clipName;
        clip.appendChild(clipText);

        if (isArrangementTrack(track)) {
          const slot = document.createElement('span');
          slot.className = 'session-track-slot session-track-slot--arrangement';
          slot.textContent = 'Arrangement';
          slot.title = 'Playing from Arrangement view';
          clip.appendChild(slot);
        } else if (track.slotIndex != null && track.slotIndex >= 0) {
          const slot = document.createElement('span');
          slot.className = 'session-track-slot';
          slot.textContent = `Slot ${track.slotIndex + 1}`;
          clip.appendChild(slot);
        }
      } else if (isArrangementTrack(track)) {
        const clipText = document.createElement('span');
        clipText.className = 'session-track-clip-name';
        clipText.textContent = '—';
        clip.appendChild(clipText);
        const slot = document.createElement('span');
        slot.className = 'session-track-slot session-track-slot--arrangement';
        slot.textContent = 'Arrangement';
        slot.title = 'Arrangement view — no clip under the playhead';
        clip.appendChild(slot);
      } else {
        clip.textContent = '—';
      }

      row.appendChild(meta);
      row.appendChild(clip);
      list.appendChild(row);
    }
  }

  parent.appendChild(list);
  return list;
}
