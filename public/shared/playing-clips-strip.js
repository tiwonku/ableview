// Shared helpers: playing watched tracks, hero title, compact clip strip for no-match UX.

export function playingTracks(payload) {
  return (payload?.tracks ?? [])
    .filter((t) => t.clipName?.trim())
    .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
}

export function hasPlayingClips(payload) {
  return playingTracks(payload).length > 0;
}

export function matchForTrack(payload, track) {
  const list = Array.isArray(payload?.trackMatches) ? payload.trackMatches : [];
  return list.find(
    (m) =>
      m.trackIndex === track.trackIndex
      || (m.trackName && track.trackName && m.trackName === track.trackName)
  ) ?? null;
}

export function isAliasTargetTrack(aliasSession, track) {
  if (!aliasSession) return false;
  if (aliasSession.trackIndex != null && track.trackIndex != null) {
    return aliasSession.trackIndex === track.trackIndex;
  }
  if (aliasSession.trackName && track.trackName) {
    return aliasSession.trackName === track.trackName;
  }
  return aliasSession.clipName === track.clipName;
}

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return '0%';
  return `${Math.round(confidence * 100)}%`;
}

/** Operator-facing headline: sheet song title when matched. */
export function resolveMatchedTitle(payload, matchColumn = null) {
  if (payload?.match?.matched !== true) return null;
  const fromRow = matchColumn && payload?.row?.[matchColumn]?.trim();
  const fromMatch = payload?.match?.matchedValue?.trim();
  return fromRow || fromMatch || payload?.clipName?.trim() || null;
}

/**
 * Hero line for operator views.
 * @returns {{ text: string, empty: boolean }}
 */
export function resolveHeroDisplay(payload, matchColumn = null) {
  const matchedTitle = resolveMatchedTitle(payload, matchColumn);
  if (matchedTitle) {
    return { text: matchedTitle, empty: false };
  }
  if (hasPlayingClips(payload)) {
    return { text: 'Nothing matched', empty: true };
  }
  return { text: 'Nothing playing', empty: true };
}

/**
 * Compact horizontal strip of playing clips (no-match remediation).
 * @param {HTMLElement} parent
 * @param {object} payload
 * @param {{ onStartAlias?: Function, aliasSession?: object|null, showDeckNames?: boolean }} opts
 */
export function renderPlayingClipsStrip(parent, payload, opts = {}) {
  const {
    onStartAlias,
    aliasSession = null,
    showDeckNames = true,
  } = opts;

  const tracks = playingTracks(payload);
  if (tracks.length === 0) return;

  const strip = document.createElement('div');
  strip.className = 'playing-clips-strip';
  strip.setAttribute('role', 'list');

  for (const track of tracks) {
    const tm = matchForTrack(payload, track);
    const aliasTarget = isAliasTargetTrack(aliasSession, track);

    const chip = document.createElement('div');
    chip.className = 'playing-clip-chip';
    chip.setAttribute('role', 'listitem');
    if (aliasTarget) chip.classList.add('playing-clip-chip--alias-target');
    else if (tm?.matched) chip.classList.add('playing-clip-chip--weak-match');
    else chip.classList.add('playing-clip-chip--nomatch');

    if (showDeckNames && track.trackName) {
      const deck = document.createElement('div');
      deck.className = 'playing-clip-chip-deck';
      deck.textContent = track.trackName;
      chip.appendChild(deck);
    }

    const clip = document.createElement('div');
    clip.className = 'playing-clip-chip-name';
    clip.textContent = track.clipName;
    clip.title = track.clipName;
    chip.appendChild(clip);

    const meta = document.createElement('div');
    meta.className = 'playing-clip-chip-meta';
    if (tm?.matched) {
      meta.textContent = `${formatConfidence(tm.confidence)} · ${tm.matchedValue || 'match'}`;
      meta.classList.add('playing-clip-chip-meta--match');
    } else {
      meta.textContent = 'No match';
      meta.classList.add('playing-clip-chip-meta--none');
    }
    chip.appendChild(meta);

    if (onStartAlias && !aliasSession && !tm?.matched) {
      const aliasBtn = document.createElement('button');
      aliasBtn.type = 'button';
      aliasBtn.className = 'playing-clip-chip-alias-btn';
      aliasBtn.textContent = 'Add as alias';
      aliasBtn.addEventListener('click', () => onStartAlias(track.clipName, track));
      chip.appendChild(aliasBtn);
    }

    strip.appendChild(chip);
  }

  parent.appendChild(strip);
}
