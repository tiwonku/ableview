import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { BREATH_CURVES, DEFAULT_BREATH } from '../../public/shared/breath-math.js';
import { DEFAULT_LIVE_COLOR_SLOTS, DEFAULT_STATIC_COLOR_SLOTS } from '../core/live-colors.js';

export const DEFAULTS = Object.freeze({
  ingest: {
    oscListenPort: 11001,
    oscSendPort: 11000,
    abletonHost: '127.0.0.1',
    watchedTracks: [],
    authoritative: { strategy: 'bestMatch', track: null },
    staleAfterMs: 5000,
    pollIntervalMs: 2000,
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
    alsFolderColumn: 'ALS Folder',
    refreshSeconds: 30,
    cacheFile: './data/sheet-cache.json',
    editorColumns: {
      BPM: { type: 'number', step: 0.1 },
      Cue: { type: 'icon', true: '✅', false: '✖' },
      Pillar: { type: 'icon', true: '✅', false: '✖' },
      RGB_1: { type: 'color' },
      RGB_2: { type: 'color' },
      RGB_3: { type: 'color' },
      ART: { type: 'image' },
    },
  },
  match: {
    threshold: 0.4,
    minConfidenceGap: 0.08,
    minFuseQueryLength: 6,
    minMatchCharLength: 4,
    fuseMinConfidence: 0.75,
    requireTokenOverlap: true,
    includeArrangement: false,
    normalize: { lowercase: true, stripPunctuation: true, stripVersionTags: true },
  },
  server: { wsHeartbeatSeconds: 5 },
  timecode: {
    enabled: false,
    port: 6454,
    bindAddress: '0.0.0.0',
    staleMs: 500,
  },
  sacn: {
    enabled: false,
    port: 5568,
    bindAddress: '0.0.0.0',
    interfaceAddress: '0.0.0.0',
    multicast: true,
    universe: 191,
    staleMs: 1000,
    ignorePreview: true,
    slots: {
      main: { ...DEFAULT_LIVE_COLOR_SLOTS.main },
      secondary: { ...DEFAULT_LIVE_COLOR_SLOTS.secondary },
      accent: { ...DEFAULT_LIVE_COLOR_SLOTS.accent },
    },
    staticSlots: {
      main: { ...DEFAULT_STATIC_COLOR_SLOTS.main },
      secondary: { ...DEFAULT_STATIC_COLOR_SLOTS.secondary },
      accent: { ...DEFAULT_STATIC_COLOR_SLOTS.accent },
    },
    viewColumns: {
      RGB_1: 'main',
      RGB_2: 'secondary',
      RGB_3: 'accent',
    },
    log: {
      changeDelta: 4,
      settleMs: 200,
      motionIntervalMs: 400,
      minIntervalMs: 100,
    },
  },
  sessionLog: {
    directory: './data/sessions',
    autoStart: false,
    autoStartWhenSim: true,
    defaultSessionName: 'test',
  },
  setlist: {
    directory: './data/setlists',
    defaultName: 'default',
  },
  moments: {
    autoStartOnMoment: true,
    kinds: ['dope', 'typed'],
    debounceMs: 0,
  },
  oscOut: {
    enabled: false,
    destinations: [],
    breath: { ...DEFAULT_BREATH },
  },
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
const VALID_STRATEGIES = ['bestMatch', 'track', 'scene', 'mostRecent'];

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
  if (config.match.minConfidenceGap != null) {
    const gap = config.match.minConfidenceGap;
    if (!(typeof gap === 'number' && gap >= 0 && gap <= 1)) {
      errors.push('match.minConfidenceGap must be between 0 and 1');
    }
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
  if (config.match.includeArrangement != null && typeof config.match.includeArrangement !== 'boolean') {
    errors.push('match.includeArrangement must be a boolean');
  }
  if (config.match.fuseMinConfidence != null) {
    const floor = config.match.fuseMinConfidence;
    if (!(typeof floor === 'number' && floor >= 0 && floor <= 1)) {
      errors.push('match.fuseMinConfidence must be between 0 and 1');
    }
  }
  if (config.match.minFuseQueryLength != null) {
    const n = config.match.minFuseQueryLength;
    if (!(Number.isInteger(n) && n >= 1)) {
      errors.push('match.minFuseQueryLength must be a positive integer');
    }
  }
  if (config.match.minMatchCharLength != null) {
    const n = config.match.minMatchCharLength;
    if (!(Number.isInteger(n) && n >= 1)) {
      errors.push('match.minMatchCharLength must be a positive integer');
    }
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

  const tc = config.timecode ?? {};
  if (!port(tc.port ?? 6454)) errors.push('timecode.port must be a valid port');
  if (tc.staleMs != null && !(tc.staleMs >= 0)) errors.push('timecode.staleMs must be >= 0');
  if (tc.bindAddress != null && typeof tc.bindAddress !== 'string') {
    errors.push('timecode.bindAddress must be a string');
  }

  const sacn = config.sacn ?? {};
  if (!port(sacn.port ?? 5568)) errors.push('sacn.port must be a valid port');
  if (sacn.staleMs != null && !(sacn.staleMs >= 0)) errors.push('sacn.staleMs must be >= 0');
  if (sacn.bindAddress != null && typeof sacn.bindAddress !== 'string') {
    errors.push('sacn.bindAddress must be a string');
  }
  if (sacn.interfaceAddress != null && typeof sacn.interfaceAddress !== 'string') {
    errors.push('sacn.interfaceAddress must be a string');
  }
  if (sacn.universe != null) {
    const u = sacn.universe;
    if (!(Number.isInteger(u) && u >= 1 && u <= 63999)) {
      errors.push('sacn.universe must be an integer 1–63999');
    }
  }
  if (sacn.multicast != null && typeof sacn.multicast !== 'boolean') {
    errors.push('sacn.multicast must be a boolean');
  }
  if (sacn.ignorePreview != null && typeof sacn.ignorePreview !== 'boolean') {
    errors.push('sacn.ignorePreview must be a boolean');
  }
  const slotIds = ['main', 'secondary', 'accent'];
  function validateSlotGroup(group, path) {
    if (group == null) return;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      errors.push(`${path} must be an object`);
      return;
    }
    for (const id of slotIds) {
      const slot = group[id];
      if (slot == null) continue;
      const ch = slot.startChannel;
      if (!(Number.isInteger(ch) && ch >= 1 && ch <= 510)) {
        errors.push(`${path}.${id}.startChannel must be an integer 1–510`);
      }
      if (slot.label != null && typeof slot.label !== 'string') {
        errors.push(`${path}.${id}.label must be a string`);
      }
    }
  }
  validateSlotGroup(sacn.slots, 'sacn.slots');
  validateSlotGroup(sacn.staticSlots, 'sacn.staticSlots');
  if (sacn.viewColumns != null) {
    if (!sacn.viewColumns || typeof sacn.viewColumns !== 'object' || Array.isArray(sacn.viewColumns)) {
      errors.push('sacn.viewColumns must be an object');
    } else {
      for (const [col, slot] of Object.entries(sacn.viewColumns)) {
        if (!slotIds.includes(slot)) {
          errors.push(`sacn.viewColumns.${col} must be one of: ${slotIds.join(', ')}`);
        }
      }
    }
  }
  const sacnLog = sacn.log ?? {};
  for (const key of ['changeDelta', 'settleMs', 'motionIntervalMs', 'minIntervalMs']) {
    if (sacnLog[key] != null && !(Number.isFinite(sacnLog[key]) && sacnLog[key] >= 0)) {
      errors.push(`sacn.log.${key} must be >= 0`);
    }
  }
  if (sacnLog.changeDelta != null && sacnLog.changeDelta > 255) {
    errors.push('sacn.log.changeDelta must be <= 255');
  }

  const sl = config.sessionLog ?? {};
  if (sl.directory != null && (typeof sl.directory !== 'string' || !sl.directory.trim())) {
    errors.push('sessionLog.directory must be a non-empty string');
  }
  if (sl.defaultSessionName != null && typeof sl.defaultSessionName !== 'string') {
    errors.push('sessionLog.defaultSessionName must be a string');
  }
  if (sl.autoStart != null && typeof sl.autoStart !== 'boolean') {
    errors.push('sessionLog.autoStart must be a boolean');
  }
  if (sl.autoStartWhenSim != null && typeof sl.autoStartWhenSim !== 'boolean') {
    errors.push('sessionLog.autoStartWhenSim must be a boolean');
  }

  const setlist = config.setlist ?? {};
  if (setlist.directory != null && (typeof setlist.directory !== 'string' || !setlist.directory.trim())) {
    errors.push('setlist.directory must be a non-empty string');
  }
  if (setlist.defaultName != null && typeof setlist.defaultName !== 'string') {
    errors.push('setlist.defaultName must be a string');
  }

  const moments = config.moments ?? {};
  if (moments.autoStartOnMoment != null && typeof moments.autoStartOnMoment !== 'boolean') {
    errors.push('moments.autoStartOnMoment must be a boolean');
  }
  if (moments.kinds != null) {
    if (!Array.isArray(moments.kinds) || moments.kinds.length === 0
      || !moments.kinds.every((k) => typeof k === 'string' && k.trim())) {
      errors.push('moments.kinds must be a non-empty array of strings');
    }
  }
  if (moments.debounceMs != null && !(moments.debounceMs >= 0)) {
    errors.push('moments.debounceMs must be >= 0');
  }

  const oscOut = config.oscOut ?? {};
  if (oscOut.enabled != null && typeof oscOut.enabled !== 'boolean') {
    errors.push('oscOut.enabled must be a boolean');
  }
  if (oscOut.destinations != null) {
    if (!Array.isArray(oscOut.destinations)) {
      errors.push('oscOut.destinations must be an array');
    } else {
      oscOut.destinations.forEach((dest, i) => {
        const path = `oscOut.destinations[${i}]`;
        if (!dest || typeof dest !== 'object' || Array.isArray(dest)) {
          errors.push(`${path} must be an object`);
          return;
        }
        if (typeof dest.host !== 'string' || !dest.host.trim()) {
          errors.push(`${path}.host is required`);
        }
        if (!port(dest.port)) {
          errors.push(`${path}.port must be a valid port`);
        }
      });
    }
  }
  const breath = oscOut.breath;
  if (breath != null) {
    if (!breath || typeof breath !== 'object' || Array.isArray(breath)) {
      errors.push('oscOut.breath must be an object');
    } else {
      if (breath.enabled != null && typeof breath.enabled !== 'boolean') {
        errors.push('oscOut.breath.enabled must be a boolean');
      }
      if (breath.rateHz != null) {
        const hz = breath.rateHz;
        if (!(Number.isInteger(hz) && hz >= 1 && hz <= 60)) {
          errors.push('oscOut.breath.rateHz must be an integer 1–60');
        }
      }
      if (breath.cycleBeats != null && !(Number.isFinite(breath.cycleBeats) && breath.cycleBeats > 0)) {
        errors.push('oscOut.breath.cycleBeats must be > 0');
      }
      if (breath.phaseOffsetBeats != null && !Number.isFinite(breath.phaseOffsetBeats)) {
        errors.push('oscOut.breath.phaseOffsetBeats must be a number');
      }
      for (const key of ['min', 'max', 'rise', 'peakHold', 'fall', 'troughHold']) {
        if (breath[key] == null) continue;
        if (!Number.isFinite(breath[key]) || breath[key] < 0) {
          errors.push(`oscOut.breath.${key} must be a number >= 0`);
        }
      }
      if (breath.min != null && breath.min > 1) errors.push('oscOut.breath.min must be <= 1');
      if (breath.max != null && breath.max > 1) errors.push('oscOut.breath.max must be <= 1');
      if (breath.min != null && breath.max != null && breath.max < breath.min) {
        errors.push('oscOut.breath.max must be >= oscOut.breath.min');
      }
      if (breath.riseCurve != null && !BREATH_CURVES.includes(breath.riseCurve)) {
        errors.push(`oscOut.breath.riseCurve must be one of: ${BREATH_CURVES.join(', ')}`);
      }
      if (breath.fallCurve != null && !BREATH_CURVES.includes(breath.fallCurve)) {
        errors.push(`oscOut.breath.fallCurve must be one of: ${BREATH_CURVES.join(', ')}`);
      }
    }
  }

  const views = config.views ?? {};
  for (const [viewId, view] of Object.entries(views)) {
    if (view.system) continue;
    if (!view.title) errors.push(`views.${viewId}.title is required`);
    if (!Array.isArray(view.fields) || view.fields.length === 0) {
      errors.push(`views.${viewId}.fields must be a non-empty array`);
    }
    for (const [i, field] of (view.fields ?? []).entries()) {
      const path = `views.${viewId}.fields[${i}]`;
      if (field?.source === 'tempo') {
        if (field.column) errors.push(`${path} cannot set both source and column`);
        continue;
      }
      if (field?.source != null) {
        errors.push(`${path}.source must be "tempo" (got "${field.source}")`);
        continue;
      }
      if (!field?.column) errors.push(`${path}.column is required (or use source: "tempo")`);
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

  if (!config.views.setlist) {
    config.views.setlist = { title: 'Set', system: true };
  }
  if (!config.views.breath) {
    config.views.breath = { title: 'Breath', system: true };
  }

  // Secrets and machine-specific settings come from the environment (§8).
  config.secrets = {
    googleServiceAccountKeyPath: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH ?? null,
    sheetId: process.env.SHEET_ID ?? null,
  };
  config.server.httpPort = Number(process.env.HTTP_PORT ?? 8080);

  validateConfig(config);
  return config;
}
