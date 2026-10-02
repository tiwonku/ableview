// On-air identity for session-log `deck_on_air` lines (M13e).
// A line is an entered identity: a deck that is newly on air, or the same
// deck with a new loaded title. Loads on a deck that is not on air, and
// stale or offline sources, do not produce a transition.

export function onAirIdentityKey(identity) {
  return `${identity.sourceId}\0${identity.deckIndex}\0${identity.title}`;
}

/**
 * Current on-air identities for one program source.
 * Returns null when the source is stale or offline so the caller keeps the
 * last key and does not treat a dropped bridge as an on-air change.
 */
export function observeSourceOnAir(source) {
  if (!source || typeof source !== 'object') return null;
  if (source.stale === true || source.live !== true) return null;
  if (typeof source.id !== 'string' || !source.id) return null;

  const decks = Array.isArray(source.decks) ? source.decks : [];
  const identities = [];
  for (const deck of decks) {
    if (deck?.onAir !== true) continue;
    const title = deck.loaded?.title;
    if (typeof title !== 'string' || !title) continue;
    identities.push({
      sourceId: source.id,
      sourceLabel: typeof source.label === 'string' && source.label.trim()
        ? source.label
        : source.id,
      deckIndex: deck.deckIndex,
      title,
      artist: typeof deck.loaded?.artist === 'string' ? deck.loaded.artist : null,
      bpm: typeof deck.bpm === 'number' && Number.isFinite(deck.bpm) ? deck.bpm : null,
      key: typeof deck.key === 'string' ? deck.key : null,
    });
  }
  identities.sort((a, b) => (a.deckIndex ?? 0) - (b.deckIndex ?? 0));
  return identities;
}

function previousSnapshot(identity) {
  return {
    sourceId: identity.sourceId,
    deckIndex: identity.deckIndex,
    title: identity.title,
  };
}

function pickPreviousOnAir(previous, departed, entered) {
  const sameDeck = departed.find((row) => row.deckIndex === entered.deckIndex);
  if (sameDeck) return previousSnapshot(sameDeck);
  if (departed.length === 1) return previousSnapshot(departed[0]);
  if (
    departed.length === 0
    && previous.length === 1
    && previous[0].deckIndex !== entered.deckIndex
  ) {
    return previousSnapshot(previous[0]);
  }
  return null;
}

/** Identities that newly match { sourceId, deckIndex, title }. */
export function onAirTransitions(previous, current) {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(current) ? current : [];
  const prevKeys = new Set(prev.map(onAirIdentityKey));
  const nextKeys = new Set(next.map(onAirIdentityKey));
  const departed = prev.filter((row) => !nextKeys.has(onAirIdentityKey(row)));
  const entered = next.filter((row) => !prevKeys.has(onAirIdentityKey(row)));
  return entered.map((deck) => ({
    deck,
    previousOnAir: pickPreviousOnAir(prev, departed, deck),
  }));
}
