// Merge a new alias into a sheet row's alias cell (pipe-separated).

import { parseAliases } from '../match/normalize.js';

export function mergeAliasValue(existing, alias) {
  const next = String(alias ?? '').trim();
  if (!next) throw new Error('alias must not be empty');

  const current = parseAliases(existing);
  const exists = current.some((a) => a.toLowerCase() === next.toLowerCase());
  if (exists) {
    return {
      value: current.join('|'),
      added: false,
      aliases: current,
    };
  }

  const aliases = [...current, next];
  return {
    value: aliases.join('|'),
    added: true,
    aliases,
  };
}

export function assertAliasColumnPresent(snapshot, aliasColumn) {
  const col = aliasColumn || snapshot?.aliasColumn;
  if (!col) throw new Error('alias column is not configured');
  const headers = snapshot?.headers ?? [];
  if (!headers.includes(col)) {
    throw new Error(
      `Aliases column "${col}" not found on the sheet. Add that header, sync, then try again.`
    );
  }
  return col;
}
