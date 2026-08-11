import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { validateConfig } from './index.js';

/** Sections editable from the admin settings panel (M7). */
export const EDITABLE_SECTIONS = ['ingest', 'sim', 'sheets', 'match', 'timecode', 'moments'];

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
    sessionLog: { ...config.sessionLog },
    moments: { ...config.moments },
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
    moments: { ...config.moments },
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
