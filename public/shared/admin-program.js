// Admin Program Sources panel (M13c). Paints the latest ProgramDeckState.
// The admin WebSocket pushes updates; this module does not fetch or match.

export function hasProgramSources(program) {
  return Array.isArray(program?.sources) && program.sources.length > 0;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function clear(node) {
  node.innerHTML = '';
}

function sourceStatus(source) {
  if (source?.live === true && source?.stale !== true) return { label: 'Live', kind: 'live' };
  if (source?.stale === true) return { label: 'Stale', kind: 'stale' };
  return { label: 'No signal', kind: 'offline' };
}

function deckMeta(deck) {
  const parts = [];
  if (typeof deck?.loaded?.artist === 'string' && deck.loaded.artist.trim()) {
    parts.push(deck.loaded.artist.trim());
  }
  if (typeof deck?.bpm === 'number' && Number.isFinite(deck.bpm)) parts.push(String(deck.bpm));
  if (typeof deck?.key === 'string' && deck.key.trim()) parts.push(deck.key.trim());
  if (typeof deck?.elapsedDisplay === 'string' && deck.elapsedDisplay.trim()) {
    parts.push(deck.elapsedDisplay.trim());
  }
  return parts.join(' · ');
}

function renderDeck(deck) {
  const onAir = deck?.onAir === true;
  const row = el('div', `admin-program-deck${onAir ? ' admin-program-deck--on-air' : ''}`);
  row.appendChild(el('span', 'admin-program-deck-index', `Deck ${deck?.deckIndex ?? '—'}`));

  const body = el('div', 'admin-program-deck-body');
  const title = typeof deck?.loaded?.title === 'string' && deck.loaded.title.trim()
    ? deck.loaded.title.trim()
    : '(empty)';
  body.appendChild(el('p', 'admin-program-deck-title', title));
  const meta = deckMeta(deck);
  if (meta) body.appendChild(el('p', 'admin-program-deck-meta', meta));
  row.appendChild(body);

  const badges = el('div', 'admin-program-deck-badges');
  if (deck?.playing === true) {
    badges.appendChild(el('span', 'program-badge program-badge--playing', 'Playing'));
  }
  if (onAir) {
    badges.appendChild(el('span', 'program-badge program-badge--on-air', 'ON AIR'));
  }
  row.appendChild(badges);
  return row;
}

function renderSource(source) {
  const status = sourceStatus(source);
  const card = el(
    'article',
    `admin-program-source admin-program-source--${status.kind}`,
  );
  const head = el('div', 'admin-program-source-head');
  head.appendChild(el('h3', 'admin-program-source-label', source?.label || source?.id || 'Source'));
  head.appendChild(el('span', `program-badge program-badge--${status.kind}`, status.label));
  card.appendChild(head);

  const decks = Array.isArray(source?.decks) ? source.decks : [];
  if (decks.length === 0) {
    const empty = status.kind === 'offline' ? 'Waiting for deck bridge' : 'No decks loaded';
    card.appendChild(el('p', 'admin-program-empty', empty));
    return card;
  }

  const list = el('div', 'admin-program-decks');
  for (const deck of decks) list.appendChild(renderDeck(deck));
  card.appendChild(list);
  return card;
}

/**
 * Fill an existing mount. Pass `compact` on the admin dashboard so the strip
 * stays inside the session pane without adding a board row.
 */
export function renderProgramPanel(mount, program, { compact = false } = {}) {
  mount.className = compact ? 'admin-program admin-program--compact' : 'admin-program';
  mount.setAttribute('aria-label', 'Program sources');
  clear(mount);

  const sources = Array.isArray(program?.sources) ? program.sources : [];
  mount.hidden = sources.length === 0;
  if (sources.length === 0) return;

  if (!compact) {
    mount.appendChild(el('h2', 'section-title', 'Program sources'));
  }

  for (const source of sources) mount.appendChild(renderSource(source));
}

export function mountProgramPanel(parent, program, { compact = false } = {}) {
  if (!hasProgramSources(program)) return null;
  const mount = document.createElement('section');
  mount.id = 'admin-program';
  renderProgramPanel(mount, program, { compact });
  parent.appendChild(mount);
  return mount;
}
