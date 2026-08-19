// Clip → alias stem helpers (shared by admin UI and server preview).

const ROLE_SUFFIXES = new Set([
  'drums',
  'drum',
  'samples',
  'sample',
  'bass',
  'vox',
  'vocals',
  'vocal',
  'synth',
  'fx',
  'perc',
  'pad',
  'lead',
  'keys',
  'guitar',
  'gtr',
  'loop',
  'loops',
]);

function normalizeForPrefix(name) {
  if (name == null) return '';
  let s = String(name).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/_/g, ' ');
  s = s.replace(/[^\w\s]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Split a clip name into selectable tokens and delimiters. */
export function tokenizeClipName(clipName) {
  const s = String(clipName ?? '');
  if (!s) return [];

  const tokens = [];
  const re = /([^\s_]+)|(_+)|(\s+)/g;
  let match;
  while ((match = re.exec(s))) {
    tokens.push({
      text: match[0],
      selectable: Boolean(match[1]),
    });
  }
  return tokens;
}

/**
 * Default alias suggestion: text before the first underscore, else the full
 * clip with a trailing role word stripped when present (e.g. "Hot Rox DRUMS").
 */
export function suggestAliasStem(clipName) {
  const raw = String(clipName ?? '').trim();
  if (!raw) return '';

  const underscored = raw.split('_')[0]?.trim();
  if (raw.includes('_') && underscored) return underscored;

  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && ROLE_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    return parts.slice(0, -1).join(' ');
  }

  return raw;
}

/** Build alias text from tokens[0..endIndex] inclusive. */
export function aliasFromTokenPrefix(tokens, endIndex) {
  if (!tokens?.length || endIndex < 0) return '';
  const end = Math.min(endIndex, tokens.length - 1);
  return tokens
    .slice(0, end + 1)
    .map((t) => t.text)
    .join('');
}

/**
 * Whether an alias would match a clip as a whole-word stem (exact, prefix, or
 * mid-clip — e.g. TTT in "Vocals TTT INTRO").
 */
export function aliasWouldMatchClip(alias, clipName) {
  const query = normalizeForPrefix(clipName);
  const stem = normalizeForPrefix(alias);
  if (!query || !stem) return false;
  return query === stem || ` ${query} `.includes(` ${stem} `);
}
