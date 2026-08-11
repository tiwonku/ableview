import { sanitizeSessionName } from './sanitize.js';

/** Local wall-clock session basename for moment auto-start (YYYY-MM-DD_HHmmss). */
export function generateAutoSessionName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return sanitizeSessionName(`${y}-${mo}-${d}_${h}${mi}${s}`);
}
