// Touch-first HSV color picker overlay for operator views.

import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './color-parse.js';

const EMPTY_START = { h: 20, s: 1, v: 1 };

/** @type {HTMLElement | null} */
let overlay = null;
/** @type {null | {
 *   onInput: (hex: string) => void,
 *   onCancel: () => void,
 *   onClear: () => void,
 *   focusRestore: Element | null,
 * }} */
let session = null;
let hsv = { ...EMPTY_START };
let emptyStart = false;

export function closeColorPicker() {
  dismiss({ restore: false });
}

export function openColorPicker({
  title = 'Color',
  hex = null,
  onInput,
  onCancel,
  onClear,
} = {}) {
  dismiss({ restore: true });

  const el = ensureOverlay();
  const parsed = hexToRgb(hex);
  emptyStart = !parsed;
  hsv = parsed ? rgbToHsv(parsed.r, parsed.g, parsed.b) : { ...EMPTY_START };

  session = {
    onInput,
    onCancel,
    onClear,
    focusRestore: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };

  const titleEl = el.querySelector('[data-role="color-picker-title"]');
  if (titleEl) titleEl.textContent = title;

  syncPickerUi();
  el.hidden = false;
  document.body.classList.add('color-picker-open');
  el.querySelector('[data-role="color-picker-done"]')?.focus();
}

function dismiss({ restore }) {
  const current = session;
  session = null;
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('color-picker-open');
  if (!current) return;
  if (restore) current.onCancel?.();
  current.focusRestore?.focus?.();
}

function emitHex() {
  if (!session || emptyStart) return;
  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  session.onInput?.(rgbToHex(rgb.r, rgb.g, rgb.b));
}

function applyUserHsv(next) {
  hsv = next;
  emptyStart = false;
  syncPickerUi();
  emitHex();
}

function ensureOverlay() {
  if (overlay) return overlay;

  const root = document.createElement('div');
  root.className = 'color-picker-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'color-picker-title');

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'color-picker-backdrop';
  backdrop.setAttribute('aria-label', 'Cancel color picker');
  backdrop.addEventListener('click', () => dismiss({ restore: true }));
  root.appendChild(backdrop);

  const panel = document.createElement('div');
  panel.className = 'color-picker-panel';

  const header = document.createElement('div');
  header.className = 'color-picker-header';

  const titleEl = document.createElement('h2');
  titleEl.className = 'color-picker-title';
  titleEl.id = 'color-picker-title';
  titleEl.dataset.role = 'color-picker-title';
  titleEl.textContent = 'Color';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'color-picker-close';
  closeBtn.textContent = 'Cancel';
  closeBtn.addEventListener('click', () => dismiss({ restore: true }));
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const stage = document.createElement('div');
  stage.className = 'color-picker-stage';

  const sv = document.createElement('div');
  sv.className = 'color-picker-sv';
  sv.dataset.role = 'color-picker-sv';
  sv.setAttribute('role', 'slider');
  sv.setAttribute('aria-label', 'Saturation and brightness');

  const svThumb = document.createElement('div');
  svThumb.className = 'color-picker-thumb color-picker-thumb--sv';
  svThumb.dataset.role = 'color-picker-sv-thumb';
  sv.appendChild(svThumb);
  bindPointer(sv, (event, el) => {
    const next = svFromPointer(el, event);
    applyUserHsv({ ...hsv, s: next.s, v: next.v });
  });
  stage.appendChild(sv);

  const hue = document.createElement('div');
  hue.className = 'color-picker-hue';
  hue.dataset.role = 'color-picker-hue';
  hue.setAttribute('role', 'slider');
  hue.setAttribute('aria-label', 'Hue');

  const hueThumb = document.createElement('div');
  hueThumb.className = 'color-picker-thumb color-picker-thumb--hue';
  hueThumb.dataset.role = 'color-picker-hue-thumb';
  hue.appendChild(hueThumb);
  bindPointer(hue, (event, el) => {
    applyUserHsv({ ...hsv, h: hueFromPointer(el, event) });
  });
  stage.appendChild(hue);
  panel.appendChild(stage);

  const meta = document.createElement('div');
  meta.className = 'color-picker-meta';

  const preview = document.createElement('div');
  preview.className = 'color-picker-preview';
  preview.dataset.role = 'color-picker-preview';
  meta.appendChild(preview);

  const values = document.createElement('div');
  values.className = 'color-picker-values';

  const rgbRow = document.createElement('p');
  rgbRow.className = 'color-picker-rgb';
  rgbRow.dataset.role = 'color-picker-rgb';
  values.appendChild(rgbRow);

  const hexLabel = document.createElement('label');
  hexLabel.className = 'color-picker-hex-label';
  hexLabel.textContent = 'Hex';

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'color-picker-hex';
  hexInput.dataset.role = 'color-picker-hex';
  hexInput.autocomplete = 'off';
  hexInput.spellcheck = false;
  hexInput.setAttribute('aria-label', 'Hex color');
  hexInput.addEventListener('input', () => {
    const raw = hexInput.value.trim();
    const withHash = raw.startsWith('#') ? raw : `#${raw}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return;
    const parsed = hexToRgb(withHash);
    if (!parsed) return;
    applyUserHsv(rgbToHsv(parsed.r, parsed.g, parsed.b));
  });
  hexInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const parsed = hexToRgb(hexInput.value);
      if (parsed) applyUserHsv(rgbToHsv(parsed.r, parsed.g, parsed.b));
    }
  });
  hexLabel.appendChild(hexInput);
  values.appendChild(hexLabel);
  meta.appendChild(values);
  panel.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'color-picker-actions';

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'color-picker-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    const current = session;
    dismiss({ restore: false });
    current?.onClear?.();
    current?.focusRestore?.focus?.();
  });
  actions.appendChild(clearBtn);

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'color-picker-btn color-picker-btn--primary';
  doneBtn.dataset.role = 'color-picker-done';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => {
    if (emptyStart) {
      dismiss({ restore: false });
      return;
    }
    emitHex();
    dismiss({ restore: false });
  });
  actions.appendChild(doneBtn);
  panel.appendChild(actions);

  root.appendChild(panel);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss({ restore: true });
    }
  });

  document.body.appendChild(root);
  overlay = root;
  return overlay;
}

function syncPickerUi() {
  if (!overlay) return;
  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
  const hueRgb = hsvToRgb(hsv.h, 1, 1);
  const hueColor = rgbToHex(hueRgb.r, hueRgb.g, hueRgb.b);

  const sv = overlay.querySelector('[data-role="color-picker-sv"]');
  const svThumb = overlay.querySelector('[data-role="color-picker-sv-thumb"]');
  const hueThumb = overlay.querySelector('[data-role="color-picker-hue-thumb"]');
  const preview = overlay.querySelector('[data-role="color-picker-preview"]');
  const rgbEl = overlay.querySelector('[data-role="color-picker-rgb"]');
  const hexInput = overlay.querySelector('[data-role="color-picker-hex"]');

  if (sv) sv.style.setProperty('--picker-hue', hueColor);
  if (svThumb) {
    svThumb.style.left = `${hsv.s * 100}%`;
    svThumb.style.top = `${(1 - hsv.v) * 100}%`;
    svThumb.style.background = hex;
  }
  if (hueThumb) hueThumb.style.setProperty('--hue-t', `${(hsv.h / 360) * 100}%`);
  if (preview) preview.style.background = hex;
  if (rgbEl) rgbEl.textContent = `RGB ${rgb.r}, ${rgb.g}, ${rgb.b}`;
  if (hexInput && document.activeElement !== hexInput) hexInput.value = hex;

  sv?.setAttribute('aria-valuetext', `Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
  overlay.querySelector('[data-role="color-picker-hue"]')
    ?.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
}

function svFromPointer(el, event) {
  const rect = el.getBoundingClientRect();
  const x = clamp01((event.clientX - rect.left) / rect.width);
  const y = clamp01((event.clientY - rect.top) / rect.height);
  return { s: x, v: 1 - y };
}

function hueFromPointer(el, event) {
  const rect = el.getBoundingClientRect();
  const horizontal = rect.width >= rect.height;
  const t = horizontal
    ? clamp01((event.clientX - rect.left) / rect.width)
    : clamp01((event.clientY - rect.top) / rect.height);
  return t * 359.99;
}

function bindPointer(el, onMove) {
  const handle = (event) => onMove(event, el);
  el.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    handle(event);
  });
  el.addEventListener('pointermove', (event) => {
    if (!el.hasPointerCapture(event.pointerId)) return;
    handle(event);
  });
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
