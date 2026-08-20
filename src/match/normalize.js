// Clip-name normalization before fuzzy matching (spec §8 match.normalize).

const VERSION_TAG_PATTERNS = [
  /\s*[-–]\s*alt(?:ernate)?\s*$/i,
  /\s+v\d+\s*$/i,
  /\s+\d+(?:\.\d+)?\s*bpm\s*$/i,
];

/** ALS-style: ignore key prefix; split on the durable `{N}bpm_` token. */
const BPM_STEM_SPLIT = /\d+\s*bpm_+/i;

const ROLE_SUFFIX = /[_\s]+(?:drums|samples|bass|vox|vocals|loops?)\s*$/i;

const ARRANGEMENT_SUFFIXES = [
  /\s*\d+\s*bars?\s+\w+\s*$/i,
  /\s+\d+\s*bars?\s*$/i,
  /\s+(?:intro|outro|drop|verse|chorus|bridge|edit|part\s*\d+)\s*$/i,
];

/**
 * Soft cleanup shared by Song Title, aliases, ALS Folder, and live clip names.
 * Does not parse musical keys — only splits on `{N}bpm_` when present.
 */
export function normalizeClipName(name, options = {}) {
  if (name == null) return '';
  let s = String(name).trim();
  if (!s) return '';

  // Prefer stem after `{N}bpm_` so key prefixes (Cm, F#m, Abmaj, …) are ignored.
  const bpmSplit = s.match(BPM_STEM_SPLIT);
  const fromAlsStem = Boolean(bpmSplit);
  if (bpmSplit) {
    s = s.slice(bpmSplit.index + bpmSplit[0].length);
  }

  s = s.replace(/_+\d{2,}\s*$/g, '').replace(/_+$/g, '');
  s = s.replace(ROLE_SUFFIX, '');
  for (const pattern of ARRANGEMENT_SUFFIXES) {
    s = s.replace(pattern, '');
  }

  // Only CamelCase-split ALS stems (GazingAtTheGlare). Leave HotRox-style aliases intact.
  if (fromAlsStem) {
    s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  s = s.replace(/_/g, ' ');

  if (options.lowercase) s = s.toLowerCase();

  if (options.stripVersionTags) {
    for (const pattern of VERSION_TAG_PATTERNS) {
      s = s.replace(pattern, '');
    }
    s = s.trim();
  }

  if (options.stripPunctuation) {
    s = s.replace(/[^\w\s]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
  } else {
    s = s.replace(/\s+/g, ' ').trim();
  }

  return s;
}

export function parseAliases(raw) {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Arrangement / role words that must not Fuse-match a song on their own. */
const GENERIC_CLIP_TOKENS = new Set([
  'intro',
  'outro',
  'layout',
  'drop',
  'verse',
  'chorus',
  'bridge',
  'build',
  'edit',
  'arrangement',
  'drums',
  'drum',
  'samples',
  'sample',
  'bass',
  'vox',
  'vocals',
  'vocal',
  'loop',
  'loops',
  'part',
  'bar',
  'bars',
]);

function compactTokens(s) {
  return s.replace(/\s+/g, '');
}

/**
 * True when the normalized clip is only arrangement/role vocabulary (INTRO, LAYOUT,
 * 140 DROP → 140). Prefix/alias matching never sees these — no match is safer.
 */
export function isGenericNormalizedQuery(query) {
  if (!query) return true;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => GENERIC_CLIP_TOKENS.has(t) || /^\d+$/.test(t));
}

/**
 * Fuse confirmation: a 4+ char token in common, or compact containment
 * (hot rox ↔ hotrox, solament ⊆ solamente).
 */
export function hasTokenOverlap(query, candidate) {
  if (!query || !candidate) return false;
  const qc = compactTokens(query);
  const cc = compactTokens(candidate);
  if (qc.length >= 4 && cc.length >= 4 && (qc.includes(cc) || cc.includes(qc))) {
    return true;
  }
  const candidateTokens = new Set(candidate.split(/\s+/).filter((t) => t.length >= 4));
  for (const token of query.split(/\s+/).filter((t) => t.length >= 4)) {
    if (candidateTokens.has(token) || cc.includes(token)) return true;
  }
  return false;
}
