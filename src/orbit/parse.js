// Orbit WebSocket payloads. Messages are usually JSON. Orbit also sends
// Python repr (single-quoted dicts). Only tagMoment "measurement" is a reading.

function asNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asInt(value, fallback = 0) {
  const n = asNumber(value);
  return n == null ? fallback : Math.round(n);
}

function asFloat(value, fallback = 0) {
  const n = asNumber(value);
  return n == null ? fallback : n;
}

function measuredAt(item) {
  const formatted = item.formattedTimestampGMT;
  if (typeof formatted === 'string' && formatted.trim()) return formatted.trim();
  const n = asNumber(item.timestamp);
  if (n == null) return null;
  const ms = Math.abs(n) > 1e12 ? n : n * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parsePythonLiteral(input) {
  const s = String(input);
  let i = 0;
  let ok = true;

  function fail() {
    ok = false;
    return null;
  }

  function skip() {
    while (i < s.length && /\s/.test(s[i])) i += 1;
  }

  function parseString(quote) {
    i += 1;
    let out = '';
    while (i < s.length) {
      const c = s[i];
      if (c === quote) {
        i += 1;
        return out;
      }
      if (c === '\\') {
        const n = s[i + 1];
        if (n == null) return fail();
        if (n === 'u') {
          const hex = s.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 6;
          continue;
        }
        const map = { n: '\n', r: '\r', t: '\t', '\\': '\\', '\'': '\'', '"': '"' };
        if (!(n in map)) return fail();
        out += map[n];
        i += 2;
        continue;
      }
      if (c === '\n' || c === '\r') return fail();
      out += c;
      i += 1;
    }
    return fail();
  }

  function keyword(word, value) {
    if (!s.startsWith(word, i)) return undefined;
    const next = s[i + word.length];
    if (next && /[A-Za-z0-9_]/.test(next)) return undefined;
    i += word.length;
    return value;
  }

  function parseNumber() {
    const match = /^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (!match) return fail();
    i += match[0].length;
    return Number(match[0]);
  }

  function parseValue() {
    skip();
    if (!ok || i >= s.length) return fail();
    const c = s[i];
    if (c === '[') return parseArray();
    if (c === '{') return parseObject();
    if (c === '\'' || c === '"') return parseString(c);
    const word = keyword('True', true) ?? keyword('False', false) ?? keyword('None', null);
    if (word !== undefined) return word;
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    return fail();
  }

  function parseArray() {
    i += 1;
    const out = [];
    skip();
    if (s[i] === ']') {
      i += 1;
      return out;
    }
    while (ok) {
      out.push(parseValue());
      if (!ok) return null;
      skip();
      if (s[i] === ',') {
        i += 1;
        skip();
        if (s[i] === ']') {
          i += 1;
          return out;
        }
        continue;
      }
      if (s[i] === ']') {
        i += 1;
        return out;
      }
      return fail();
    }
    return null;
  }

  function parseObject() {
    i += 1;
    const out = {};
    skip();
    if (s[i] === '}') {
      i += 1;
      return out;
    }
    while (ok) {
      skip();
      if (s[i] !== '\'' && s[i] !== '"') return fail();
      const key = parseString(s[i]);
      if (!ok) return null;
      skip();
      if (s[i] !== ':') return fail();
      i += 1;
      const value = parseValue();
      if (!ok) return null;
      out[key] = value;
      skip();
      if (s[i] === ',') {
        i += 1;
        skip();
        if (s[i] === '}') {
          i += 1;
          return out;
        }
        continue;
      }
      if (s[i] === '}') {
        i += 1;
        return out;
      }
      return fail();
    }
    return null;
  }

  const value = parseValue();
  skip();
  if (!ok || i !== s.length) return null;
  return value;
}

function decodeRaw(raw) {
  if (Buffer.isBuffer(raw)) return raw.toString('utf8').trim();
  if (typeof raw === 'string') return raw.trim();
  return '';
}

/**
 * Readings from one Orbit message.
 * Returns null when the text is not a payload. Returns [] when the payload
 * parsed and contained no measurement for this session.
 */
export function parseOrbitMessage(raw, { bandId } = {}) {
  const text = decodeRaw(raw);
  if (!text) return null;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = parsePythonLiteral(text);
  }
  if (parsed == null) return null;

  const items = Array.isArray(parsed) ? parsed : [parsed];
  if (!items.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    if (!Array.isArray(parsed)) return null;
  }

  const filter = typeof bandId === 'string' ? bandId.trim() : '';
  const readings = [];
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.tagMoment !== 'measurement') continue;
    const memberId = typeof item.memberId === 'string' ? item.memberId.trim() : '';
    if (!memberId) continue;
    const itemBand = typeof item.bandId === 'string' ? item.bandId : null;
    if (filter && itemBand !== filter) continue;
    const name = typeof item.memberName === 'string' ? item.memberName.trim() : '';
    readings.push({
      memberId,
      memberName: name || memberId,
      heartRate: asInt(item.rate, 0),
      heartRateAvg: asFloat(item.average, 0),
      calories: asFloat(item.calories, 0),
      batteryLevel: asInt(item.batteryLevel, 0),
      bandId: itemBand,
      measuredAt: measuredAt(item),
    });
  }
  return readings;
}
