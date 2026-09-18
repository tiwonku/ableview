// Flash look: copy live GrandMA sACN RGB into sheet color columns.

import { parseRgbCell } from './color-parse.js';
import {
  DEFAULT_LIVE_COLOR_COLUMNS,
  rgbToLiveDisplay,
  slotForColumn,
} from './live-color-overlay.js';
import { fieldLabel } from './field-display.js';

export const FLASH_LOOK_MOTION_DELTA = 4;

export function flashableColorColumns(fields, columnMap = DEFAULT_LIVE_COLOR_COLUMNS) {
  const seen = new Set();
  const out = [];
  for (const field of fields ?? []) {
    if (field?.type !== 'color' || !field.column) continue;
    if (!slotForColumn(field.column, columnMap)) continue;
    if (seen.has(field.column)) continue;
    seen.add(field.column);
    out.push(field.column);
  }
  return out;
}

export function liveColorsToEditorChanges(status, columnMap = DEFAULT_LIVE_COLOR_COLUMNS, { columns } = {}) {
  const keys = columns?.length ? columns : Object.keys(columnMap ?? {});
  const changes = {};
  if (status?.live !== true) return changes;
  for (const column of keys) {
    const slot = slotForColumn(column, columnMap);
    if (!slot) continue;
    const color = rgbToLiveDisplay(status.colors?.[slot]);
    if (!color?.hex) continue;
    changes[column] = color.hex;
  }
  return changes;
}

export function canFlashLook(status, columns, columnMap = DEFAULT_LIVE_COLOR_COLUMNS) {
  if (!columns?.length) return false;
  if (status?.enabled !== true || status?.live !== true) return false;
  if (status?.preview === true) return false;
  return Object.keys(liveColorsToEditorChanges(status, columnMap, { columns })).length > 0;
}

export function flashLookDisabledReason(status, columns, columnMap = DEFAULT_LIVE_COLOR_COLUMNS) {
  if (!columns?.length) return 'No GrandMA color fields on this view';
  if (status?.enabled !== true) return 'GrandMA sACN is off';
  if (status?.preview === true) return 'GrandMA is in preview — Flash is disabled';
  if (status?.live !== true) return 'No GrandMA signal';
  if (!Object.keys(liveColorsToEditorChanges(status, columnMap, { columns })).length) {
    return 'No GrandMA color data';
  }
  return 'Write GrandMA colors to this cue';
}

export function isLiveColorMoving(prev, next, { threshold = FLASH_LOOK_MOTION_DELTA } = {}) {
  if (!prev?.colors || !next?.colors) return false;
  if (next.live !== true) return false;
  return maxSlotDelta(prev.colors, next.colors) >= threshold;
}

export function buildFlashLookSlots({
  fields,
  row,
  liveColors,
  columnMap = DEFAULT_LIVE_COLOR_COLUMNS,
  columns,
} = {}) {
  const cols = columns ?? flashableColorColumns(fields, columnMap);
  const fieldByColumn = new Map((fields ?? []).filter((f) => f?.column).map((f) => [f.column, f]));
  return cols.map((column) => {
    const slot = slotForColumn(column, columnMap);
    const sheet = parseRgbCell(row?.[column]);
    const live = rgbToLiveDisplay(liveColors?.colors?.[slot]);
    return {
      column,
      label: fieldLabel(fieldByColumn.get(column) ?? { column }),
      slot,
      sheet,
      live,
      rainbow: sheet?.kind === 'rainbow',
      canWrite: Boolean(live?.hex),
    };
  });
}

export function flashLookChangesForColumns(slots, columns) {
  const want = new Set(columns ?? []);
  const changes = {};
  for (const slot of slots ?? []) {
    if (!want.has(slot.column) || !slot.live?.hex) continue;
    changes[slot.column] = slot.live.hex;
  }
  return changes;
}

export function flashLookWarnings(slots, { moving = false } = {}) {
  const warnings = [];
  if (moving) warnings.push('Look is still moving (chase / fade). Flash anyway or wait.');
  const rainbow = (slots ?? []).filter((s) => s.rainbow && s.canWrite).map((s) => s.label);
  if (rainbow.length) {
    warnings.push(`${joinLabels(rainbow)} is RAINBOW — Flash will replace it.`);
  }
  const missing = (slots ?? []).filter((s) => !s.canWrite).map((s) => s.label);
  if (missing.length && missing.length < (slots?.length ?? 0)) {
    warnings.push(`No GrandMA data for ${joinLabels(missing)} — those slots will be skipped.`);
  }
  return warnings;
}

function joinLabels(labels) {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function maxSlotDelta(a, b) {
  const slots = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  let max = 0;
  for (const id of slots) {
    const ca = a?.[id];
    const cb = b?.[id];
    if (!ca && !cb) continue;
    if (!ca || !cb) return 255;
    max = Math.max(
      max,
      Math.abs(ca.r - cb.r),
      Math.abs(ca.g - cb.g),
      Math.abs(ca.b - cb.b),
    );
  }
  return max;
}
