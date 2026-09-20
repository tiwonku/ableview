import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateConfig } from './index.js';
import { DEFAULT_LIVE_COLOR_COLUMNS, DEFAULT_LIVE_COLOR_SLOTS, DEFAULT_STATIC_COLOR_SLOTS } from '../core/live-colors.js';
import { DEFAULT_BREATH, normalizeBreathSettings } from '../../public/shared/breath-math.js';

function serializeBreath(breath) {
  const src = normalizeBreathSettings({ ...DEFAULT_BREATH, ...breath });
  return {
    enabled: src.enabled,
    rateHz: src.rateHz,
    cycleBeats: src.cycleBeats,
    phaseOffsetBeats: src.phaseOffsetBeats,
    min: src.min,
    max: src.max,
    rise: src.rise,
    peakHold: src.peakHold,
    fall: src.fall,
    troughHold: src.troughHold,
    riseCurve: src.riseCurve,
    fallCurve: src.fallCurve,
  };
}

function serializeOscOut(oscOut) {
  return {
    enabled: oscOut?.enabled === true,
    destinations: Array.isArray(oscOut?.destinations)
      ? oscOut.destinations.map((d) => ({ host: d.host, port: d.port }))
      : [],
    breath: serializeBreath(oscOut?.breath),
  };
}

function serializeSlotGroup(srcSlots, defaults) {
  const slots = {};
  for (const id of ['main', 'secondary', 'accent']) {
    const slot = srcSlots?.[id] ?? defaults[id];
    slots[id] = {
      startChannel: slot?.startChannel ?? defaults[id].startChannel,
      label: slot?.label ?? defaults[id].label,
    };
  }
  return slots;
}

function serializeSacn(sacn) {
  const src = sacn ?? {};
  return {
    enabled: src.enabled === true,
    port: src.port ?? 5568,
    bindAddress: src.bindAddress ?? '0.0.0.0',
    interfaceAddress: src.interfaceAddress ?? '0.0.0.0',
    multicast: src.multicast !== false,
    universe: src.universe ?? 191,
    staleMs: src.staleMs ?? 1000,
    ignorePreview: src.ignorePreview !== false,
    slots: serializeSlotGroup(src.slots, DEFAULT_LIVE_COLOR_SLOTS),
    staticSlots: serializeSlotGroup(src.staticSlots, DEFAULT_STATIC_COLOR_SLOTS),
    viewColumns: { ...DEFAULT_LIVE_COLOR_COLUMNS, ...(src.viewColumns ?? {}) },
    log: {
      changeDelta: src.log?.changeDelta ?? 4,
      settleMs: src.log?.settleMs ?? 200,
      motionIntervalMs: src.log?.motionIntervalMs ?? 400,
      minIntervalMs: src.log?.minIntervalMs ?? 100,
    },
  };
}

/** Sections editable from the admin settings panel (M7). */
export const EDITABLE_SECTIONS = ['ingest', 'sim', 'sheets', 'match', 'timecode', 'sacn', 'moments', 'oscOut'];

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

/** Settings written to config.json (excludes secrets and env-only values). */
export function serializeFileConfig(config) {
  return {
    ingest: { ...config.ingest },
    sim: { ...config.sim },
    sheets: { ...config.sheets },
    match: { ...config.match },
    server: { wsHeartbeatSeconds: config.server.wsHeartbeatSeconds },
    timecode: { ...config.timecode },
    sacn: serializeSacn(config.sacn),
    sessionLog: { ...config.sessionLog },
    setlist: { ...config.setlist },
    moments: { ...config.moments },
    oscOut: serializeOscOut(config.oscOut),
    views: { ...config.views },
  };
}

export function pickEditableSettings(config) {
  return {
    ingest: { ...config.ingest },
    sim: { ...config.sim },
    sheets: { ...config.sheets },
    match: { ...config.match },
    timecode: { ...config.timecode },
    sacn: serializeSacn(config.sacn),
    moments: { ...config.moments },
    oscOut: serializeOscOut(config.oscOut),
  };
}

function pickPatch(patch) {
  const out = {};
  for (const section of EDITABLE_SECTIONS) {
    if (patch[section] !== undefined) out[section] = patch[section];
  }
  return out;
}

export function sectionsTouched(patch) {
  return EDITABLE_SECTIONS.filter((s) => patch[s] !== undefined);
}

export function writeConfigFile(configPath, config, cwd = process.cwd()) {
  const abs = resolve(cwd, configPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(serializeFileConfig(config), null, 2)}\n`, 'utf8');
}

/**
 * Runtime config holder: mutate in place, validate, persist, and notify reload handlers.
 */
export function createConfigRuntime({ config, configPath = './config/config.json', cwd = process.cwd(), log }) {
  const reloadHandlers = [];

  function getConfig() {
    return config;
  }

  function getSettings() {
    return pickEditableSettings(config);
  }

  function onReload(handler) {
    reloadHandlers.push(handler);
  }

  async function updateSettings(patch) {
    const limited = pickPatch(patch);
    if (Object.keys(limited).length === 0) {
      throw new Error('No editable settings in request');
    }

    for (const section of Object.keys(limited)) {
      config[section] = deepMerge(config[section], limited[section]);
    }

    // Destination list is replaced as a whole (add/remove in admin), not merged by index.
    if (limited.oscOut?.destinations !== undefined) {
      if (!config.oscOut) config.oscOut = { enabled: false, destinations: [] };
      config.oscOut.destinations = Array.isArray(limited.oscOut.destinations)
        ? limited.oscOut.destinations.map((d) => ({
          host: String(d?.host ?? '').trim(),
          port: Number(d?.port),
        }))
        : [];
    }

    validateConfig(config);
    writeConfigFile(configPath, config, cwd);

    const touched = sectionsTouched(limited);
    log.info({ sections: touched }, 'config updated from admin');

    for (const handler of reloadHandlers) {
      await handler(touched);
    }

    return { settings: getSettings(), reloaded: touched };
  }

  return { getConfig, getSettings, updateSettings, onReload };
}

export function readConfigFile(configPath, cwd = process.cwd()) {
  return JSON.parse(readFileSync(resolve(cwd, configPath), 'utf8'));
}
