/** Admin dashboard flash for a recent Dope press. Holds 30s beside the album art. */

export const DOPE_FLASH_MS = 30_000;

const FUTURE_SKEW_MS = 2000;

export function createDopeFlashTracker({
  now = () => Date.now(),
  holdMs = DOPE_FLASH_MS,
} = {}) {
  let presses = [];
  let seenLoggedAt = null;

  function prune(at) {
    presses = presses.filter((press) => {
      const age = at - Date.parse(press.loggedAt);
      return Number.isFinite(age) && age < holdMs;
    });
  }

  function snapshot(at = now()) {
    prune(at);
    if (presses.length === 0) return null;
    const latest = presses[presses.length - 1];
    const remainingMs = holdMs - (at - Date.parse(latest.loggedAt));
    return {
      who: latest.who,
      timestamp: latest.timestamp,
      loggedAt: latest.loggedAt,
      count: presses.length,
      remainingMs: Math.max(0, remainingMs),
    };
  }

  function nextChangeMs(at = now()) {
    prune(at);
    if (presses.length === 0) return null;
    let soonest = Infinity;
    for (const press of presses) {
      const left = holdMs - (at - Date.parse(press.loggedAt));
      if (left < soonest) soonest = left;
    }
    return Math.max(0, soonest);
  }

  function ingest(lastMoment, at = now()) {
    let added = false;
    if (lastMoment?.kind === 'dope' && lastMoment.loggedAt) {
      const loggedAt = String(lastMoment.loggedAt);
      if (loggedAt !== seenLoggedAt) {
        seenLoggedAt = loggedAt;
        const age = at - Date.parse(loggedAt);
        if (Number.isFinite(age) && age < holdMs && age > -FUTURE_SKEW_MS) {
          presses.push({
            loggedAt,
            who: lastMoment.who ?? null,
            timestamp: lastMoment.timestamp ?? null,
          });
          added = true;
        }
      }
    }
    return { added, snapshot: snapshot(at) };
  }

  return { ingest, snapshot, nextChangeMs };
}

/** Show-clock HH:MM:SS. Drops SMPTE frames. Falls back to wall clock. */
export function formatDopeTime(timestamp, loggedAt) {
  const raw = String(timestamp ?? '').trim();
  const match = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3]}`;
  }
  const date = new Date(loggedAt ?? '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function dopeFlashParts(snapshot) {
  if (!snapshot) return null;
  const who = String(snapshot.who ?? '').trim() || null;
  const time = formatDopeTime(snapshot.timestamp, snapshot.loggedAt);
  const count = snapshot.count > 1 ? snapshot.count : null;
  const bits = ['Dope'];
  if (count) bits.push(`${count} presses`);
  if (who) bits.push(who);
  if (time) bits.push(time);
  return {
    kind: 'Dope',
    who,
    time,
    count,
    label: bits.join(', '),
  };
}

function removeNode(node) {
  if (!node) return;
  if (typeof node.remove === 'function') node.remove();
  else node.parentNode?.removeChild?.(node);
}

function revealMast(mast) {
  if (!mast.hidden) return;
  mast.hidden = false;
  if (mast.dataset) mast.dataset.dopeUnhid = '1';
}

/** Hide a mast we opened only when both the flash and the set tally are gone. */
function maybeConcealMast(mast) {
  if (mast.dataset?.dopeUnhid !== '1') return;
  if (mast.querySelector('.admin-dope-slot') || mast.querySelector('.admin-dope-tally')) return;
  mast.hidden = true;
  delete mast.dataset.dopeUnhid;
}

function tallyRows(tally) {
  if (!Array.isArray(tally)) return [];
  const rows = [];
  for (const row of tally) {
    const count = Number(row?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    rows.push({ who: row.who ?? null, count });
  }
  return rows;
}

export function dopeTallyName(who) {
  const name = String(who ?? '').trim();
  return name || 'unknown';
}

function nextSiblingOf(node) {
  if (!node) return null;
  if ('nextSibling' in node) return node.nextSibling ?? null;
  const children = node.parentNode?.childNodes;
  if (!children || typeof children.indexOf !== 'function') return null;
  const index = children.indexOf(node);
  return index >= 0 ? (children[index + 1] ?? null) : null;
}

function placeTally(mast, strip) {
  const slot = mast.querySelector('.admin-dope-slot');
  const desiredBefore = slot ? nextSiblingOf(slot) : mast.firstChild;
  if (desiredBefore === strip) return;
  if (strip.parentNode === mast) mast.removeChild(strip);
  const before = slot ? nextSiblingOf(slot) : mast.firstChild;
  mast.insertBefore(strip, before);
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function span(doc, className, text) {
  const el = doc.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Insert or remove the flash as the first child of `.admin-dashboard-mast`.
 * Returns false when the dashboard look is not on screen.
 */
export function paintAdminDopeSlot(root, snapshot, { pulse = false } = {}) {
  if (!root?.querySelector) return false;
  const mast = root.querySelector('.admin-dashboard-mast');
  if (!mast) return false;

  const doc = mast.ownerDocument ?? root.ownerDocument ?? globalThis.document;
  let slot = mast.querySelector('.admin-dope-slot');

  if (!snapshot) {
    removeNode(slot);
    maybeConcealMast(mast);
    return true;
  }

  revealMast(mast);

  const parts = dopeFlashParts(snapshot);
  if (!slot) {
    slot = doc.createElement('div');
    slot.className = 'admin-dope-slot';
    slot.dataset.role = 'admin-dope-slot';
    slot.setAttribute('role', 'status');
    slot.setAttribute('aria-live', 'assertive');
    mast.insertBefore(slot, mast.firstChild);
  }

  clearChildren(slot);
  slot.setAttribute('aria-label', parts.label);
  slot.appendChild(span(doc, 'admin-dope-slot-kind', parts.kind));
  if (parts.count) slot.appendChild(span(doc, 'admin-dope-slot-count', `×${parts.count}`));
  if (parts.who) slot.appendChild(span(doc, 'admin-dope-slot-who', parts.who));
  if (parts.time) slot.appendChild(span(doc, 'admin-dope-slot-time', parts.time));

  slot.classList.remove('admin-dope-slot--pulse');
  if (pulse) {
    void slot.offsetWidth;
    slot.classList.add('admin-dope-slot--pulse');
  }
  return true;
}

function fillDopeTally(strip, doc, rows, latestWho) {
  const names = rows.map((row) => `${dopeTallyName(row.who)} ${row.count}`);
  clearChildren(strip);
  strip.setAttribute('aria-label', `Dope this set: ${names.join(', ')}`);
  strip.appendChild(span(doc, 'admin-dope-tally-label', 'Dope'));
  const markLatest = latestWho !== undefined;
  for (const row of rows) {
    const person = doc.createElement('span');
    person.className = 'admin-dope-tally-person';
    if (markLatest && row.who === latestWho) {
      person.classList.add('admin-dope-tally-person--latest');
    }
    person.appendChild(span(doc, 'admin-dope-tally-who', dopeTallyName(row.who)));
    person.appendChild(span(doc, 'admin-dope-tally-count', String(row.count)));
    strip.appendChild(person);
  }
}

/**
 * Standing per-person dope count for the current session.
 * Sits under the 30s flash on the admin dashboard mast.
 */
export function paintAdminDopeTally(root, tally, { latestWho } = {}) {
  if (!root?.querySelector) return false;
  const mast = root.querySelector('.admin-dashboard-mast');
  if (!mast) return false;

  const doc = mast.ownerDocument ?? root.ownerDocument ?? globalThis.document;
  let strip = mast.querySelector('.admin-dope-tally');
  const rows = tallyRows(tally);

  if (!rows.length) {
    removeNode(strip);
    maybeConcealMast(mast);
    return true;
  }

  revealMast(mast);
  if (!strip) {
    strip = doc.createElement('div');
    strip.className = 'admin-dope-tally';
    strip.dataset.role = 'admin-dope-tally';
    strip.setAttribute('role', 'status');
    strip.setAttribute('aria-live', 'polite');
  }

  fillDopeTally(strip, doc, rows, latestWho);
  placeTally(mast, strip);
  return true;
}

/** Same tally, inside the Set page live card. */
export function paintSetDopeTally(root, tally, { latestWho } = {}) {
  if (!root?.querySelector) return false;
  const host = root.querySelector('.set-dope-tally');
  if (!host) return false;

  const doc = host.ownerDocument ?? root.ownerDocument ?? globalThis.document;
  const rows = tallyRows(tally);
  if (!rows.length) {
    clearChildren(host);
    host.hidden = true;
    host.removeAttribute?.('aria-label');
    return true;
  }

  host.hidden = false;
  fillDopeTally(host, doc, rows, latestWho);
  return true;
}
