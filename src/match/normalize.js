// Clip-name normalization before fuzzy matching (spec §8 match.normalize).

const VERSION_TAG_PATTERNS = [
  /\s*[-–]\s*alt(?:ernate)?\s*$/i,
  /\s+v\d+\s*$/i,
  /\s+\d+(?:\.\d+)?\s*bpm\s*$/i,
];

export function normalizeClipName(name, options = {}) {
  if (name == null) return '';
  let s = String(name).trim();
  if (!s) return '';

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
