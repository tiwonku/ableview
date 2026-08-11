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
