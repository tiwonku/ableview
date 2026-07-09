// Sheet cell format helpers for the row editor (read ↔ widget ↔ save).

import { parseRgbCell } from './color-parse.js';

export const DEFAULT_ICON = Object.freeze({ true: '✅', false: '✖' });

const VALID_TYPES = new Set(['text', 'number', 'color', 'icon']);

export function normalizeColumnConfig(config) {
  if (!config || typeof config !== 'object') return { type: 'text' };
  const type = VALID_TYPES.has(config.type) ? config.type : 'text';
  if (type === 'icon') {
    return {
      type,
      true: config.true ?? DEFAULT_ICON.true,
      false: config.false ?? DEFAULT_ICON.false,
    };
  }
  if (type === 'number') {
    return { type, step: config.step ?? 1, min: config.min ?? 0 };
  }
  return { type };
}

/** Parse a sheet cell string into editor widget state. */
export function parseCellForEditor(raw, columnConfig) {
  const cfg = normalizeColumnConfig(columnConfig);
  const text = raw == null ? '' : String(raw);

  switch (cfg.type) {
    case 'number':
      return text.trim();
    case 'color': {
      const parsed = parseRgbCell(text);
      return parsed?.hex ?? null;
    }
    case 'icon':
      return text.trim() === cfg.true;
    default:
      return text;
  }
}

/** Convert editor widget state to a sheet cell string. */
export function formatCellForSheet(state, columnConfig) {
  const cfg = normalizeColumnConfig(columnConfig);

  switch (cfg.type) {
    case 'number': {
      const trimmed = String(state ?? '').trim();
      if (!trimmed) return '';
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < cfg.min) {
        throw new Error(`must be a number >= ${cfg.min}`);
      }
      return String(n);
    }
    case 'color': {
      const hex = String(state ?? '').trim();
      if (!hex) return '';
      const rgb = hexToRgb(hex);
      if (!rgb) throw new Error('must be a valid color');
      return `${rgb.r},${rgb.g},${rgb.b}`;
    }
    case 'icon':
      return state ? cfg.true : cfg.false;
    default:
      return state == null ? '' : String(state);
  }
}

/**
 * Validate and format a changes object for Google Sheets.
 * Returns formatted strings keyed by column name.
 */
export function validateAndFormatChanges(changes, editorColumns, headers) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('changes must be an object');
  }

  const headerSet = new Set(headers);
  const formatted = {};

  for (const [column, value] of Object.entries(changes)) {
    if (!headerSet.has(column)) {
      throw new Error(`unknown column: ${column}`);
    }
    const columnConfig = editorColumns?.[column] ?? { type: 'text' };
    try {
      formatted[column] = formatCellForSheet(value, columnConfig);
    } catch (err) {
      throw new Error(`${column}: ${err.message}`);
    }
  }

  return formatted;
}

function hexToRgb(hex) {
  const normalized = String(hex).trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const n = Number.parseInt(normalized, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}
