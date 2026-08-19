// Shared helpers: playing watched tracks, hero title, compact clip strip for no-match UX.

import { suggestAliasStem } from './alias-stem.js';

export function playingTracks(payload) {
  return (payload?.tracks ?? [])
    .filter((t) => t.clipName?.trim())
    .sort((a, b) => (a.trackIndex ?? 0) - (b.trackIndex ?? 0));
}

export function hasPlayingClips(payload) {
  return playingTracks(payload).length > 0;
}

export function isArrangementTrack(track) {
  return track?.source === 'arrangement';
}

export function hasArrangementPlayback(payload) {
  return (payload?.tracks ?? []).some((t) => isArrangementTrack(t));
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

export function isCreateTargetTrack(createSession, track) {
  if (!createSession || createSession.mode !== 'create') return false;
  if (createSession.trackIndex != null && track.trackIndex != null) {
    return createSession.trackIndex === track.trackIndex;
  }
  if (createSession.trackName && track.trackName) {
    return createSession.trackName === track.trackName;
  }
  return createSession.clipNameAtEdit === track.clipName;
}

function clipOverride(clipNameOverride) {
  return typeof clipNameOverride === 'string' ? clipNameOverride.trim() : '';
}

/** Clip name to pre-fill on "Add cue row" (per-deck override, else payload / first playing). */
export function resolveCreateClipName(payload, clipNameOverride = null) {
  return clipOverride(clipNameOverride)
    || payload?.clipName?.trim()
    || playingTracks(payload)[0]?.clipName?.trim()
    || '';
}

/**
 * Whether "Add cue row" should open the editor.
 * Per-deck create is allowed even when another watched track already won the match.
 */
export function canStartCreate(payload, clipNameOverride = null) {
  if (!resolveCreateClipName(payload, clipNameOverride)) return false;
  if (clipOverride(clipNameOverride)) return true;
  return payload?.match?.matched !== true;
}

/**
 * Hero line for operator views.
 * @returns {{ text?: string, empty?: boolean, showHero: boolean, noMatch?: boolean }}
 */
export function resolveHeroDisplay(payload, matchColumn = null, { busy = false, noMatchHero = false } = {}) {
  if (busy) return { showHero: false };

  const matchedTitle = resolveMatchedTitle(payload, matchColumn);
  if (matchedTitle) {
    return { text: matchedTitle, empty: false, showHero: true };
  }
  if (hasPlayingClips(payload)) {
    if (noMatchHero) {
      return { text: 'No Match', empty: false, showHero: true, noMatch: true };
    }
    return { showHero: false };
  }
  return { text: 'Nothing playing', empty: true, showHero: true };
}

/** Columns for operator-view create: title, aliases, then view fields. */
export function operatorCreateColumns(viewFields, matchColumn, aliasColumn) {
  const cols = [];
  if (matchColumn) cols.push(matchColumn);
  if (aliasColumn && aliasColumn !== matchColumn) cols.push(aliasColumn);
  for (const field of viewFields ?? []) {
    const column = field?.column;
    if (column && !cols.includes(column)) cols.push(column);
  }
  return cols;
}

/**
 * Playing-clip cards for the no-match state (operator views scale these up).
 * @param {HTMLElement} parent
 * @param {object} payload
 * @param {{
 *   onStartAlias?: Function,
 *   onStartCreate?: Function,
 *   aliasSession?: object|null,
 *   createSession?: object|null,
 *   showDeckNames?: boolean,
 * }} opts
 */
export function renderPlayingClipsStrip(parent, payload, opts = {}) {
  const {
    onStartAlias,
    onStartCreate,
    aliasSession = null,
    createSession = null,
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
    const createTarget = isCreateTargetTrack(createSession, track);
    const unmatched = !tm?.matched;

    const chip = document.createElement('div');
    chip.className = 'playing-clip-chip';
    chip.setAttribute('role', 'listitem');
    if (aliasTarget) chip.classList.add('playing-clip-chip--alias-target');
    else if (createTarget) chip.classList.add('playing-clip-chip--create-target');
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

    if (!aliasSession && !createSession && unmatched) {
      const actions = document.createElement('div');
      actions.className = 'playing-clip-chip-actions';

      if (onStartAlias) {
        const aliasBtn = document.createElement('button');
        aliasBtn.type = 'button';
        aliasBtn.className = 'playing-clip-chip-alias-btn';
        aliasBtn.textContent = 'Add as alias';
        aliasBtn.addEventListener('click', () => onStartAlias(track.clipName, track));
        actions.appendChild(aliasBtn);
      }

      if (onStartCreate) {
        const createBtn = document.createElement('button');
        createBtn.type = 'button';
        createBtn.className = 'playing-clip-chip-create-btn';
        createBtn.textContent = 'Add cue row';
        createBtn.addEventListener('click', () => onStartCreate(track.clipName, track));
        actions.appendChild(createBtn);
      }

      if (actions.childElementCount) chip.appendChild(actions);
    }

    strip.appendChild(chip);
  }

  parent.appendChild(strip);
}

export { suggestAliasStem };
