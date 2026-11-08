/** Quiet heart-rate strip for the admin dashboard, under the Dope banner. */

import { holdAdminDashboardMast, releaseAdminDashboardMast } from './admin-dope-flash.js';

function personName(person) {
  const name = String(person?.memberName || person?.memberId || '').trim();
  return name || 'watch';
}

export function heartRateGlance(orbit) {
  if (!orbit || orbit.enabled !== true) return null;
  const people = Array.isArray(orbit.participants) ? orbit.participants : [];
  const rows = [];
  for (const person of people) {
    const rate = Number(person?.heartRate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rows.push({
      name: personName(person),
      bpm: Math.round(rate),
      quiet: person?.active !== true,
    });
  }
  if (rows.length === 0) return null;
  return {
    rows,
    label: `Heart rate: ${rows.map((row) => `${row.name} ${row.bpm}`).join(', ')}`,
  };
}

function removeNode(node) {
  if (!node) return;
  if (typeof node.remove === 'function') node.remove();
  else node.parentNode?.removeChild?.(node);
}

function nextSiblingOf(node) {
  if (!node) return null;
  if ('nextSibling' in node) return node.nextSibling ?? null;
  const children = node.parentNode?.childNodes;
  if (!children || typeof children.indexOf !== 'function') return null;
  const index = children.indexOf(node);
  return index >= 0 ? (children[index + 1] ?? null) : null;
}

function placeHeart(mast, strip) {
  const tally = mast.querySelector('.admin-dope-tally');
  const slot = mast.querySelector('.admin-dope-slot');
  const anchor = tally || slot;
  const desiredBefore = anchor ? nextSiblingOf(anchor) : mast.firstChild;
  if (desiredBefore === strip) return;
  if (strip.parentNode === mast) mast.removeChild(strip);
  const before = anchor ? nextSiblingOf(anchor) : mast.firstChild;
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

function heartHost(root) {
  const mast = root.querySelector('.admin-dashboard-mast');
  if (mast) return mast;
  return root.querySelector('.admin-dashboard-main')
    ?? root.querySelector('.admin-dashboard-board');
}

function placeOnHost(host, strip) {
  if (host.classList.contains('admin-dashboard-mast')) {
    placeHeart(host, strip);
    return;
  }
  if (host.firstChild === strip) return;
  host.insertBefore(strip, host.firstChild);
}

/**
 * Quiet strip under the Dope banner when the look is up.
 * Otherwise the first row of the dashboard board.
 * Returns false when the admin dashboard is not on screen.
 */
export function paintAdminHeartRate(root, orbit) {
  if (!root?.querySelector) return false;
  const host = heartHost(root);
  if (!host) return false;

  const doc = host.ownerDocument ?? root.ownerDocument ?? globalThis.document;
  let strip = root.querySelector('.admin-heart-slot');
  const glance = heartRateGlance(orbit);

  if (!glance) {
    const parent = strip?.parentNode;
    removeNode(strip);
    if (parent?.classList?.contains('admin-dashboard-mast')) releaseAdminDashboardMast(parent);
    return true;
  }

  if (host.classList.contains('admin-dashboard-mast')) holdAdminDashboardMast(host);
  if (!strip) {
    strip = doc.createElement('div');
    strip.dataset.role = 'admin-heart-slot';
    strip.setAttribute('role', 'status');
    strip.setAttribute('aria-live', 'polite');
  }
  strip.className = host.classList.contains('admin-dashboard-mast')
    ? 'admin-heart-slot'
    : 'admin-heart-slot admin-heart-slot--board';

  clearChildren(strip);
  strip.setAttribute('aria-label', glance.label);
  strip.appendChild(span(doc, 'admin-heart-label', 'HR'));
  for (const row of glance.rows) {
    const person = doc.createElement('span');
    person.className = row.quiet
      ? 'admin-heart-person admin-heart-person--quiet'
      : 'admin-heart-person';
    person.appendChild(span(doc, 'admin-heart-name', row.name));
    person.appendChild(span(doc, 'admin-heart-bpm', String(row.bpm)));
    person.appendChild(span(doc, 'admin-heart-unit', 'bpm'));
    strip.appendChild(person);
  }
  placeOnHost(host, strip);
  return true;
}
