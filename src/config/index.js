import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

export const DEFAULTS = Object.freeze({
  ingest: {
    oscListenPort: 11001,
    oscSendPort: 11000,
    abletonHost: '127.0.0.1',
    watchedTracks: [],
    authoritative: { strategy: 'track', track: null },
  },
  sim: {
    enabled: false,
    mode: 'internal',
    driver: 'scenario',
    scenario: './config/scenarios/demo-set.json',
    intervalSeconds: 8,
  },
  sheets: {
    worksheet: 'Cues',
    headerRow: 1,
    matchColumn: 'Clip Name',
    aliasColumn: 'Aliases',
    refreshSeconds: 30,
    cacheFile: './data/sheet-cache.json',
  },
  match: {
    threshold: 0.4,
    normalize: { lowercase: true, stripPunctuation: true, stripVersionTags: true },
  },
  server: { wsHeartbeatSeconds: 5 },
  views: {},
});

function deepMerge(base, override) {
  if (override === undefined) return base;
  if (
    base === null || override === null ||
    typeof base !== 'object' || typeof override !== 'object' ||
    Array.isArray(base) || Array.isArray(override)
  ) {
    return override;
  }
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

const VALID_SIM_MODES = ['internal', 'osc'];
const VALID_SIM_DRIVERS = ['sheetClipNames', 'scenario', 'manual'];
const VALID_STRATEGIES = ['track', 'scene', 'mostRecent'];

export function validateConfig(config) {
  const errors = [];

  const port = (v) => Number.isInteger(v) && v > 0 && v < 65536;
  if (!port(config.ingest.oscListenPort)) errors.push('ingest.oscListenPort must be a valid port');
  if (!port(config.ingest.oscSendPort)) errors.push('ingest.oscSendPort must be a valid port');
  if (!VALID_STRATEGIES.includes(config.ingest.authoritative.strategy)) {
    errors.push(`ingest.authoritative.strategy must be one of: ${VALID_STRATEGIES.join(', ')}`);
  }
  if (config.ingest.authoritative.strategy === 'track' && !config.ingest.authoritative.track && config.ingest.authoritative.track !== 0) {
    errors.push('ingest.authoritative.track is required when strategy is "track"');
  }
  if (!VALID_SIM_MODES.includes(config.sim.mode)) {
    errors.push(`sim.mode must be one of: ${VALID_SIM_MODES.join(', ')}`);
  }
  if (!VALID_SIM_DRIVERS.includes(config.sim.driver)) {
    errors.push(`sim.driver must be one of: ${VALID_SIM_DRIVERS.join(', ')}`);
  }
  if (!(config.sim.intervalSeconds > 0)) errors.push('sim.intervalSeconds must be > 0');
  if (!(config.match.threshold >= 0 && config.match.threshold <= 1)) {
    errors.push('match.threshold must be between 0 and 1');
  }
  if (!(config.sheets.refreshSeconds > 0)) errors.push('sheets.refreshSeconds must be > 0');
  if (!Number.isInteger(config.sheets.headerRow) || config.sheets.headerRow < 1) {
    errors.push('sheets.headerRow must be a positive integer (1-based sheet row number)');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

export function loadConfig({ configPath = './config/config.json', envPath = '.env', cwd = process.cwd() } = {}) {
  dotenv.config({ path: resolve(cwd, envPath), quiet: true });

  let fileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(resolve(cwd, configPath), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Failed to read ${configPath}: ${err.message}`);
  }

  const config = validateConfig(deepMerge(DEFAULTS, fileConfig));

  // Secrets and machine-specific settings come from the environment (§8).
  config.secrets = {
    googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ?? null,
    sheetId: process.env.SHEET_ID ?? null,
  };
  config.server.httpPort = Number(process.env.HTTP_PORT ?? 8080);

  return config;
}
