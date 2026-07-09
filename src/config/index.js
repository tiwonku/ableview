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
    quantDelaySeconds: 1,
  },
  sheets: {
    worksheet: 'Cues',
    headerRow: 1,
    matchColumn: 'Clip Name',
    aliasColumn: 'Aliases',
    refreshSeconds: 30,
    cacheFile: './data/sheet-cache.json',
    editorColumns: {
      BPM: { type: 'number', step: 0.1 },
      Cue: { type: 'icon', true: '✅', false: '✖' },
      Pillar: { type: 'icon', true: '✅', false: '✖' },
      RGB_1: { type: 'color' },
      RGB_2: { type: 'color' },
      RGB_3: { type: 'color' },
    },
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
  if (config.sim.quantDelaySeconds != null && !(config.sim.quantDelaySeconds >= 0)) {
    errors.push('sim.quantDelaySeconds must be >= 0');
  }
  if (!(config.match.threshold >= 0 && config.match.threshold <= 1)) {
    errors.push('match.threshold must be between 0 and 1');
  }
  if (!(config.sheets.refreshSeconds > 0)) errors.push('sheets.refreshSeconds must be > 0');
  if (!Number.isInteger(config.sheets.headerRow) || config.sheets.headerRow < 1) {
    errors.push('sheets.headerRow must be a positive integer (1-based sheet row number)');
  }
  if (config.server.httpPort != null) {
    const hp = config.server.httpPort;
    // Port 0 is valid for OS-assigned listen ports (tests and ephemeral binds).
    if (!(Number.isInteger(hp) && hp >= 0 && hp < 65536)) {
      errors.push('HTTP_PORT must be a valid port');
    }
  }
  if (!(config.server.wsHeartbeatSeconds >= 0)) {
    errors.push('server.wsHeartbeatSeconds must be >= 0');
  }

  const views = config.views ?? {};
  for (const [viewId, view] of Object.entries(views)) {
    if (view.system) continue;
    if (!view.title) errors.push(`views.${viewId}.title is required`);
    if (!Array.isArray(view.fields) || view.fields.length === 0) {
      errors.push(`views.${viewId}.fields must be a non-empty array`);
    }
    for (const [i, field] of (view.fields ?? []).entries()) {
      if (!field?.column) errors.push(`views.${viewId}.fields[${i}].column is required`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

export function validateProductionReady(config) {
  const errors = [];

  if (config.sim.enabled) return config;

  const views = config.views ?? {};
  if (Object.keys(views).length === 0) {
    errors.push('views must define at least one view');
  }
  if (!views.admin?.system) {
    errors.push('views.admin with system: true is required for production');
  }

  if (!config.secrets?.googleServiceAccountKeyPath) {
    errors.push('GOOGLE_SERVICE_ACCOUNT_KEY_PATH is required when not in simulation mode');
  }
  if (!config.secrets?.sheetId) {
    errors.push('SHEET_ID is required when not in simulation mode');
  }

  if (errors.length > 0) {
    throw new Error(`Production config incomplete:\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

export function shouldValidateProduction() {
  return process.env.NODE_ENV === 'production' || process.env.ABLEVIEW_PRODUCTION === '1';
}

export function loadConfig({ configPath = './config/config.json', envPath = '.env', cwd = process.cwd() } = {}) {
  dotenv.config({ path: resolve(cwd, envPath), quiet: true });

  let fileConfig = {};
  try {
    fileConfig = JSON.parse(readFileSync(resolve(cwd, configPath), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`Failed to read ${configPath}: ${err.message}`);
  }

  const config = deepMerge(DEFAULTS, fileConfig);

  // Secrets and machine-specific settings come from the environment (§8).
  config.secrets = {
    googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ?? null,
    sheetId: process.env.SHEET_ID ?? null,
  };
  config.server.httpPort = Number(process.env.HTTP_PORT ?? 8080);

  validateConfig(config);
  return config;
}
