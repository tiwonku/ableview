// Camelot field: neighbor chips + expandable 24-slot wheel.

import { fieldLabel, getFieldValue } from './field-display.js';
import {
  camelotWheelSlots,
  formatHarmonyChip,
  harmonyFromRaw,
  slotRelation,
} from './camelot.js';

/** @type {HTMLElement | null} */
let camelotOverlay = null;

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

function wedgePath(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${r1} ${r1} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function slotAngles(n) {
  const start = (n % 12) * 30 - 90;
  return { start, end: start + 30, mid: start + 15 };
}

function hueForNumber(n) {
  return Math.round(((n - 1) / 12) * 360);
}

export function renderCamelotWheel(harmony) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'camelot-wheel');
  svg.setAttribute('viewBox', '0 0 320 320');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    `Camelot wheel. Current ${harmony.current.name} ${harmony.current.code}`,
  );

  const cx = 160;
  const cy = 160;
  const rings = { B: { r0: 92, r1: 150 }, A: { r0: 42, r1: 90 } };

  for (const slot of camelotWheelSlots(harmony.prefer)) {
    const { start, end, mid } = slotAngles(slot.n);
    const ring = rings[slot.letter];
    const rel = slotRelation(slot.n, slot.letter, harmony.current);
    const hue = hueForNumber(slot.n);
    const fill = rel === 'current'
      ? `hsl(${hue} 70% 48%)`
      : rel
        ? `hsl(${hue} 42% 32%)`
        : `hsl(${hue} 16% 16%)`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', wedgePath(cx, cy, ring.r0, ring.r1, start, end));
    path.setAttribute('class', `camelot-wedge${rel ? ` camelot-wedge--${rel}` : ''}`);
    path.setAttribute('fill', fill);
    svg.appendChild(path);

    const labelR = (ring.r0 + ring.r1) / 2;
    const [tx, ty] = polar(cx, cy, labelR, mid);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(tx));
    label.setAttribute('y', String(ty));
    label.setAttribute('class', `camelot-wedge-label${rel ? ` camelot-wedge-label--${rel}` : ''}`);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle');
    const code = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    code.setAttribute('x', String(tx));
    code.setAttribute('dy', '-0.35em');
    code.textContent = slot.code;
    const name = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    name.setAttribute('x', String(tx));
    name.setAttribute('dy', '1.15em');
    name.textContent = slot.name;
    label.append(code, name);
    svg.appendChild(label);
  }

  const hub = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  hub.setAttribute('cx', String(cx));
  hub.setAttribute('cy', String(cy));
  hub.setAttribute('r', '38');
  hub.setAttribute('class', 'camelot-hub');
  svg.appendChild(hub);

  const hubName = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  hubName.setAttribute('x', String(cx));
  hubName.setAttribute('y', String(cy - 6));
  hubName.setAttribute('class', 'camelot-hub-name');
  hubName.setAttribute('text-anchor', 'middle');
  hubName.setAttribute('dominant-baseline', 'middle');
  hubName.textContent = harmony.current.name;
  svg.appendChild(hubName);

  const hubCode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  hubCode.setAttribute('x', String(cx));
  hubCode.setAttribute('y', String(cy + 14));
  hubCode.setAttribute('class', 'camelot-hub-code');
  hubCode.setAttribute('text-anchor', 'middle');
  hubCode.setAttribute('dominant-baseline', 'middle');
  hubCode.textContent = harmony.current.code;
  svg.appendChild(hubCode);

  return svg;
}

function ensureCamelotOverlay() {
  if (camelotOverlay) return camelotOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'field-expand-overlay camelot-overlay';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'field-expand-backdrop';
  backdrop.setAttribute('aria-label', 'Close');
  backdrop.addEventListener('click', closeCamelotOverlay);
  overlay.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'field-expand-panel field-expand-panel--camelot';

  const header = document.createElement('div');
  header.className = 'field-expand-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'field-expand-title';
  titleEl.id = 'camelot-overlay-title';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'field-expand-close';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', closeCamelotOverlay);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'field-expand-body field-expand-body--camelot';
  body.id = 'camelot-overlay-body';
  panel.appendChild(body);

  overlay.appendChild(panel);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCamelotOverlay();
  });

  document.body.appendChild(overlay);
  camelotOverlay = overlay;
  return overlay;
}

export function closeCamelotOverlay() {
  if (!camelotOverlay || camelotOverlay.hidden) return;
  camelotOverlay.hidden = true;
  document.body.classList.remove('field-expand-open');
}

export function openCamelotOverlay(harmony, title = 'Harmony') {
  const overlay = ensureCamelotOverlay();
  const titleEl = overlay.querySelector('#camelot-overlay-title');
  const bodyEl = overlay.querySelector('#camelot-overlay-body');
  if (!titleEl || !bodyEl) return;

  titleEl.textContent = `${title} · ${harmony.current.name} ${harmony.current.code}`;
  bodyEl.replaceChildren(renderCamelotWheel(harmony));
  overlay.hidden = false;
  document.body.classList.add('field-expand-open');
  overlay.querySelector('.field-expand-close')?.focus();
}

function renderChip(entry, kind) {
  const chip = document.createElement('span');
  chip.className = `camelot-chip camelot-chip--${kind}`;
  chip.textContent = formatHarmonyChip(entry);
  return chip;
}

export function renderCamelotField(field, payload) {
  const label = fieldLabel(field) || 'Harmony';
  const raw = getFieldValue(field, payload);
  const harmony = harmonyFromRaw(raw);

  const card = document.createElement('div');
  card.className = 'field field--token field--camelot';

  const labelEl = document.createElement('p');
  labelEl.className = 'field-label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueWrap = document.createElement('div');
  valueWrap.className = 'field-value-body';

  if (!harmony) {
    const empty = document.createElement('p');
    empty.className = 'field-value empty';
    empty.textContent = '—';
    valueWrap.appendChild(empty);
    card.appendChild(valueWrap);
    return card;
  }

  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'camelot-open';
  openBtn.setAttribute('aria-label', `Open harmonic wheel for ${harmony.current.name}`);
  openBtn.title = 'Tap for Camelot wheel';

  const byRole = Object.fromEntries(harmony.neighbors.map((n) => [n.role, n]));
  openBtn.appendChild(renderChip(byRole.relative, 'relative'));

  const pair = document.createElement('span');
  pair.className = 'camelot-neighbors';
  pair.appendChild(renderChip(byRole.prev, 'prev'));
  pair.appendChild(renderChip(byRole.next, 'next'));
  openBtn.appendChild(pair);

  openBtn.addEventListener('click', () => openCamelotOverlay(harmony, label));
  valueWrap.appendChild(openBtn);
  card.appendChild(valueWrap);
  return card;
}
