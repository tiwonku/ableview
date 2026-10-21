// Placeable setlist glance for operator views.
// Shows the live setlist row plus the next two, with key and sheet colors.
// A click opens the whole set. Scroll follows the window: down when the
// window is taller than it is wide, across when it is wider than it is tall.
// Not a match source. An unmatched cue never highlights a setlist row (NFR-7).

import { applyColorSwatchStyle, parseRgbCell } from './color-parse.js';
import { resolveMatchedTitle } from './playing-clips-strip.js';

const PREVIEW_AHEAD = 2;
const KEY_COLUMN = 'Key';
const ROLES = ['now', 'next', 'after'];
const ROLE_LABEL = { now: 'Now', next: 'Next', after: 'After' };

let previewPassSawModule = false;
let modalOpen = false;
let lastModel = null;
let paintedCurrentId = null;
let modalAxis = 'horizontal';
let overlay = null;
let resizeQueued = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null && text !== '') node.textContent = text;
  return node;
}

function itemTitle(item) {
  return String(item?.liveTitle || item?.title || '').trim() || `Row ${item?.rowId ?? '?'}`;
}

function normalizeItem(item, index) {
  const status = item?.status === 'likely' || item?.status === 'maybe' ? item.status : 'confirmed';
  return {
    rowId: String(item?.rowId ?? ''),
    index,
    title: itemTitle(item),
    key: String(item?.key ?? '').trim(),
    colors: Array.isArray(item?.colors) ? item.colors : [],
    status,
    missing: Boolean(item?.missing),
  };
}

function colorColumnsFromFields(fields) {
  const seen = new Set();
  const columns = [];
  for (const field of fields ?? []) {
    if (field?.type !== 'color' || !field.column || seen.has(field.column)) continue;
    seen.add(field.column);
    columns.push({
      column: field.column,
      label: String(field.label ?? '').trim() || field.column,
    });
  }
  return columns;
}

function colorsFromRow(row, colorColumns) {
  if (!row || !colorColumns?.length) return [];
  const colors = [];
  for (const col of colorColumns) {
    const raw = row[col.column];
    if (raw == null || String(raw).trim() === '') continue;
    colors.push({ column: col.column, label: col.label, value: String(raw) });
  }
  return colors;
}

function emptySlot(role) {
  return {
    role,
    empty: true,
    title: '',
    key: '',
    colors: [],
    status: 'confirmed',
    missing: false,
    current: false,
    pinned: false,
    offSet: false,
    unmatched: false,
    waiting: false,
    rowId: '',
    index: -1,
  };
}

function filledSlot(role, extra) {
  return { ...emptySlot(role), empty: false, ...extra };
}

function slotFromItem(item, role, { current = false, pinned = false } = {}) {
  return filledSlot(role, {
    rowId: item.rowId,
    index: item.index,
    title: item.title,
    key: item.key,
    colors: item.colors,
    status: item.status,
    missing: item.missing,
    current,
    pinned,
  });
}

/**
 * Glance model: live setlist position, the next two songs, and the full list.
 * @param {object|null} payload CuePayload
 * @param {object|null} setlist hydrated setlist state
 * @param {{ label?: string, matchColumn?: string|null, colorColumns?: {column: string, label: string}[] }} [options]
 */
export function setlistPreviewModel(payload, setlist, options = {}) {
  const items = (Array.isArray(setlist?.items) ? setlist.items : []).map(normalizeItem);
  const label = String(options.label ?? '').trim() || 'Set';
  const name = String(setlist?.name ?? '').trim();
  const matched = payload?.match?.matched === true;
  const pinned = matched && payload?.match?.viaOverride === true;
  const liveRowId = matched && payload.match.rowId != null && String(payload.match.rowId).trim() !== ''
    ? String(payload.match.rowId)
    : null;
  const currentIndex = liveRowId
    ? items.findIndex((item) => item.rowId === liveRowId)
    : -1;
  const onSet = currentIndex >= 0;

  const listed = items.map((item) => ({
    ...item,
    current: onSet && item.index === currentIndex,
    played: onSet && item.index < currentIndex,
    pinned: onSet && item.index === currentIndex && pinned,
  }));

  let slots;
  if (!payload) {
    slots = [
      filledSlot('now', { waiting: true, title: 'Waiting…' }),
      emptySlot('next'),
      emptySlot('after'),
    ];
  } else if (!matched) {
    const clip = String(payload.clipName ?? '').trim();
    slots = [
      filledSlot('now', {
        unmatched: true,
        title: clip || 'No confident match',
      }),
      emptySlot('next'),
      emptySlot('after'),
    ];
  } else if (!onSet) {
    const title = resolveMatchedTitle(payload, options.matchColumn ?? null)
      || payload.match?.matchedValue
      || payload.clipName
      || 'Matched';
    slots = [
      filledSlot('now', {
        offSet: true,
        pinned,
        title: String(title).trim() || 'Matched',
        key: String(payload.row?.[KEY_COLUMN] ?? '').trim(),
        colors: colorsFromRow(payload.row, options.colorColumns),
      }),
      emptySlot('next'),
      emptySlot('after'),
    ];
  } else {
    slots = ROLES.map((role, offset) => {
      const item = items[currentIndex + offset];
      if (!item) return emptySlot(role);
      return slotFromItem(item, role, { current: offset === 0, pinned: offset === 0 && pinned });
    });
  }

  return {
    label,
    name,
    onSet,
    matched,
    currentIndex,
    currentRowId: onSet ? items[currentIndex].rowId : null,
    slots: slots.slice(0, PREVIEW_AHEAD + 1),
    items: listed,
  };
}

function parseSwatches(colors) {
  const swatches = [];
  for (const entry of colors ?? []) {
    const color = parseRgbCell(entry?.value);
    if (!color) continue;
    const column = String(entry?.column ?? '').trim();
    const label = String(entry?.label ?? '').trim() || column || 'Color';
    swatches.push({ column, label, color });
  }
  return swatches;
}

function appendSwatches(parent, colors, title) {
  const swatches = parseSwatches(colors);
  if (!swatches.length) return;
  const row = el('span', 'setlist-slot-colors');
  const song = String(title ?? '').trim();
  const detail = swatches.map((swatch) => `${swatch.label} ${swatch.color.rgbText}`).join(', ');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', song ? `Colors for ${song}: ${detail}` : `Colors: ${detail}`);
  for (const swatch of swatches) {
    const node = el('span', 'color-swatch setlist-slot-swatch');
    applyColorSwatchStyle(node, swatch.color);
    node.title = `${swatch.label}: ${swatch.color.rgbText}`;
    node.setAttribute('aria-hidden', 'true');
    row.appendChild(node);
  }
  parent.appendChild(row);
}

function keyBadge(key) {
  const value = String(key ?? '').trim();
  const badge = el('span', value ? 'setlist-slot-key' : 'setlist-slot-key setlist-slot-key--empty', value || '—');
  badge.title = value ? `Key ${value}` : 'No key';
  return badge;
}

function slotCaption(slot) {
  if (slot.empty || slot.waiting) return '';
  const parts = [];
  if (slot.pinned) parts.push('Pinned');
  if (slot.offSet) parts.push('Not on set');
  if (slot.unmatched && slot.title !== 'No confident match') parts.push('No confident match');
  if (slot.missing) parts.push('Missing');
  if (slot.status === 'likely') parts.push('Likely');
  if (slot.status === 'maybe') parts.push('Maybe');
  return parts.join(' · ');
}

function renderSlot(slot) {
  const card = el('span', `setlist-slot setlist-slot--${slot.role}`);
  if (slot.current) card.classList.add('setlist-slot--current');
  if (slot.empty) card.classList.add('setlist-slot--empty');
  if (slot.offSet) card.classList.add('setlist-slot--offset');
  if (slot.unmatched) card.classList.add('setlist-slot--unmatched');

  const kicker = slot.index >= 0
    ? `${ROLE_LABEL[slot.role]} · #${slot.index + 1}`
    : ROLE_LABEL[slot.role];
  card.appendChild(el('span', 'setlist-slot-kicker', kicker));
  card.appendChild(el('span', 'setlist-slot-title', slot.empty ? '—' : (slot.title || '—')));
  const caption = slotCaption(slot);
  if (caption) card.appendChild(el('span', 'setlist-slot-note', caption));
  if (!slot.empty && !slot.waiting && !slot.unmatched) {
    const meta = el('span', 'setlist-slot-meta');
    meta.appendChild(keyBadge(slot.key));
    if (slot.role !== 'now') appendSwatches(meta, slot.colors, slot.title);
    card.appendChild(meta);
  }
  return card;
}

function moduleAriaLabel(model) {
  const bits = [`${model.label}${model.name ? `, ${model.name}` : ''}`];
  for (const slot of model.slots) {
    const role = ROLE_LABEL[slot.role] ?? slot.role;
    if (slot.empty) bits.push(`${role}, none`);
    else bits.push(`${role}, ${slot.title}${slot.key ? `, key ${slot.key}` : ''}`);
  }
  bits.push('Open the full set');
  return bits.join('. ');
}

function readScrollAxis() {
  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  return height > width ? 'vertical' : 'horizontal';
}

/**
 * Mouse-wheel movement for the sideways peek. A trackpad already scrolling
 * sideways is left to the browser. Null means do not take over the gesture.
 */
export function horizontalPeekWheelDelta({
  deltaX = 0,
  deltaY = 0,
  deltaMode = 0,
  clientWidth = 0,
} = {}) {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return null;
  let delta = deltaY;
  if (deltaMode === 1) delta *= 48;
  else if (deltaMode === 2) delta *= clientWidth || 0;
  if (!delta) return null;
  return delta;
}

function presentIsAway(track) {
  const card = track?.querySelector?.('[data-current="true"]');
  if (!card) return false;
  const view = track.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const horizontal = track.classList.contains('setlist-modal-track--horizontal');
  if (horizontal) {
    const mid = (view.left + view.right) / 2;
    return box.right < mid - 8 || box.left > mid + 8;
  }
  const mid = (view.top + view.bottom) / 2;
  return box.bottom < mid - 8 || box.top > mid + 8;
}

function syncPresentButton() {
  const button = overlay?.querySelector('.setlist-modal-present');
  const track = overlay?.querySelector('[data-role="setlist-modal-track"]');
  if (!button || !track) return;
  button.hidden = !(modalOpen && presentIsAway(track));
}

function returnToPresent() {
  const track = overlay?.querySelector('[data-role="setlist-modal-track"]');
  const current = track?.querySelector('[data-current="true"]');
  current?.scrollIntoView({ inline: 'center', block: 'center', behavior: 'smooth' });
}

let snapTimer = 0;

function onPanelWheel(event) {
  const track = overlay?.querySelector('[data-role="setlist-modal-track"]');
  if (!track?.classList.contains('setlist-modal-track--horizontal')) return;
  if (event.target?.closest?.('.setlist-modal-present, .setlist-modal-close')) return;
  const delta = horizontalPeekWheelDelta({
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    clientWidth: track.clientWidth,
  });
  if (delta == null) return;
  if (track.scrollWidth <= track.clientWidth + 1) return;
  event.preventDefault();
  track.style.scrollSnapType = 'none';
  track.scrollLeft += delta;
  clearTimeout(snapTimer);
  snapTimer = setTimeout(() => {
    track.style.scrollSnapType = '';
    syncPresentButton();
  }, 160);
}

function renderModalCard(item) {
  const card = el('article', 'setlist-modal-card');
  if (item.current) {
    card.classList.add('setlist-modal-card--now');
    card.dataset.current = 'true';
  }
  if (item.played) card.classList.add('setlist-modal-card--played');
  if (item.missing) card.classList.add('setlist-modal-card--missing');
  card.dataset.rowId = item.rowId;

  card.appendChild(el('span', 'setlist-modal-index', String(item.index + 1)));
  card.appendChild(keyBadge(item.key));

  const main = el('div', 'setlist-modal-main');
  const titleRow = el('div', 'setlist-modal-title-row');
  titleRow.appendChild(el('h3', 'setlist-modal-title', item.title));
  if (item.current) {
    titleRow.appendChild(el('span', 'setlist-modal-badge', item.pinned ? 'Pinned now' : 'Now'));
  } else if (item.played) {
    titleRow.appendChild(el('span', 'setlist-modal-badge setlist-modal-badge--played', 'Played'));
  }
  if (item.status === 'likely' || item.status === 'maybe') {
    titleRow.appendChild(el(
      'span',
      'setlist-modal-badge setlist-modal-badge--status',
      item.status === 'likely' ? 'Likely' : 'Maybe',
    ));
  }
  if (item.missing) {
    titleRow.appendChild(el('span', 'setlist-modal-badge setlist-modal-badge--missing', 'Missing'));
  }
  main.appendChild(titleRow);
  appendSwatches(main, item.colors, item.title);
  card.appendChild(main);
  return card;
}

function paintModal(model, { recenter = false } = {}) {
  if (!overlay || !modalOpen || !model) return;
  const title = overlay.querySelector('#setlist-modal-title');
  const meta = overlay.querySelector('[data-role="setlist-modal-meta"]');
  const track = overlay.querySelector('[data-role="setlist-modal-track"]');
  if (!track) return;

  modalAxis = readScrollAxis();
  track.className = `setlist-modal-track setlist-modal-track--${modalAxis}`;

  if (title) {
    title.textContent = model.name ? `${model.label} · ${model.name}` : model.label;
  }
  if (meta) {
    if (!model.items.length) meta.textContent = 'No songs on this set';
    else if (model.currentIndex >= 0) meta.textContent = `Now ${model.currentIndex + 1} of ${model.items.length}`;
    else meta.textContent = `${model.items.length} songs`;
  }

  const prevLeft = track.scrollLeft;
  const prevTop = track.scrollTop;
  track.replaceChildren();

  if (!model.items.length) {
    track.appendChild(el('p', 'setlist-modal-empty', 'No songs on tonight\'s set.'));
    return;
  }

  for (const item of model.items) track.appendChild(renderModalCard(item));

  if (recenter) {
    const current = track.querySelector('[data-current="true"]');
    requestAnimationFrame(() => {
      current?.scrollIntoView({ inline: 'center', block: 'center' });
      syncPresentButton();
    });
  } else {
    track.scrollLeft = prevLeft;
    track.scrollTop = prevTop;
    syncPresentButton();
  }
}

function onResize() {
  if (!modalOpen || resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    if (!modalOpen) return;
    const axis = readScrollAxis();
    if (axis === modalAxis) return;
    paintModal(lastModel, { recenter: true });
  });
}

function ensureModal() {
  if (overlay) return overlay;

  overlay = el('div', 'setlist-modal');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'setlist-modal-title');

  const backdrop = el('button', 'setlist-modal-backdrop');
  backdrop.type = 'button';
  backdrop.setAttribute('aria-label', 'Close setlist');
  backdrop.addEventListener('click', () => closeSetlistPreview());

  const panel = el('div', 'setlist-modal-panel');
  const header = el('div', 'setlist-modal-header');
  const heading = el('div', 'setlist-modal-heading');
  const title = el('h2', 'setlist-modal-heading-title');
  title.id = 'setlist-modal-title';
  heading.append(title, el('p', 'setlist-modal-meta'));
  heading.querySelector('p').dataset.role = 'setlist-modal-meta';

  const presentBtn = el('button', 'setlist-modal-present', 'Return to present');
  presentBtn.type = 'button';
  presentBtn.hidden = true;
  presentBtn.addEventListener('click', () => returnToPresent());

  const closeBtn = el('button', 'setlist-modal-close', 'Close');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => closeSetlistPreview());
  header.append(heading, presentBtn, closeBtn);

  const track = el('div', 'setlist-modal-track');
  track.dataset.role = 'setlist-modal-track';
  track.addEventListener('scroll', () => syncPresentButton(), { passive: true });
  panel.append(header, track);
  panel.addEventListener('wheel', onPanelWheel, { passive: false });
  overlay.append(backdrop, panel);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSetlistPreview();
  });
  document.body.appendChild(overlay);
  window.addEventListener('resize', onResize);
  return overlay;
}

function openSetlistPreview(model) {
  lastModel = model;
  ensureModal();
  modalOpen = true;
  overlay.hidden = false;
  document.body.classList.add('setlist-modal-open');
  paintedCurrentId = model?.currentRowId ?? null;
  paintModal(model, { recenter: true });
  overlay.querySelector('.setlist-modal-close')?.focus();
}

export function closeSetlistPreview() {
  if (!modalOpen) return;
  modalOpen = false;
  paintedCurrentId = null;
  if (overlay) {
    overlay.hidden = true;
    const presentBtn = overlay.querySelector('.setlist-modal-present');
    if (presentBtn) presentBtn.hidden = true;
  }
  document.body.classList.remove('setlist-modal-open');
}

export function beginSetlistPreviewPass() {
  previewPassSawModule = false;
}

export function endSetlistPreviewPass() {
  if (!previewPassSawModule) closeSetlistPreview();
}

export function renderSetlistModule(field, {
  payload = null,
  setlist = null,
  fields = null,
  matchColumn = null,
  layout = 'stack',
} = {}) {
  previewPassSawModule = true;
  const model = setlistPreviewModel(payload, setlist, {
    label: field?.label,
    matchColumn,
    colorColumns: colorColumnsFromFields(fields),
  });
  lastModel = model;
  if (modalOpen) {
    const currentChanged = model.currentRowId !== paintedCurrentId;
    paintedCurrentId = model.currentRowId;
    paintModal(model, { recenter: currentChanged });
  }

  const button = el('button', `setlist-module setlist-module--${layout === 'row' ? 'row' : 'stack'}`);
  button.type = 'button';
  button.dataset.role = 'setlist-module';
  button.title = 'Open the full set';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', moduleAriaLabel(model));

  const head = el('span', 'setlist-module-head');
  head.appendChild(el('span', 'setlist-module-label', model.label));
  if (model.name) head.appendChild(el('span', 'setlist-module-name', model.name));
  head.appendChild(el('span', 'setlist-module-open', 'All'));
  button.appendChild(head);

  const slots = el('span', 'setlist-module-slots');
  for (const slot of model.slots) {
    if (slot.empty && slot.role !== 'now') continue;
    slots.appendChild(renderSlot(slot));
  }
  button.appendChild(slots);

  button.addEventListener('click', () => openSetlistPreview(model));
  return button;
}
