export class SessionLogDisabledError extends Error {
  constructor() {
    super('Enable session logging before marking moments.');
    this.name = 'SessionLogDisabledError';
    this.code = 'session_log_disabled';
  }
}

export class UnknownKindError extends Error {
  constructor(kind) {
    super(`Unknown moment kind: ${kind}`);
    this.name = 'UnknownKindError';
    this.code = 'unknown_kind';
    this.kind = kind;
  }
}

export class WhoTooLongError extends Error {
  constructor() {
    super('who must be at most 64 characters');
    this.name = 'WhoTooLongError';
    this.code = 'who_too_long';
  }
}

export class NoteTooLongError extends Error {
  constructor() {
    super('note must be at most 200 characters');
    this.name = 'NoteTooLongError';
    this.code = 'note_too_long';
  }
}

export class MomentDebouncedError extends Error {
  constructor(retryAfterMs) {
    super('Duplicate moment suppressed by debounce');
    this.name = 'MomentDebouncedError';
    this.code = 'debounced';
    this.retryAfterMs = retryAfterMs;
  }
}

const WHO_MAX = 64;
const NOTE_MAX = 200;

export function normalizeWho(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new WhoTooLongError();
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > WHO_MAX) throw new WhoTooLongError();
  return trimmed.replace(/[\r\n\0]/g, '');
}

export function normalizeNote(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new NoteTooLongError();
  const stripped = raw.replace(/[\r\n\0]/g, ' ').trim();
  if (!stripped) return null;
  if (stripped.length > NOTE_MAX) throw new NoteTooLongError();
  return stripped;
}

export function resolveKind(raw, allowedKinds) {
  const kinds = Array.isArray(allowedKinds) && allowedKinds.length > 0
    ? allowedKinds
    : ['dope'];
  const kind = (raw == null || raw === '') ? 'dope' : String(raw).trim();
  if (!kinds.includes(kind)) throw new UnknownKindError(kind);
  return kind;
}

export function momentDebounceKey(kind, who) {
  return `${kind}\0${who ?? ''}`;
}
