import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBus } from '../src/core/bus.js';
import { createLogger } from '../src/core/logger.js';
import { DEFAULTS, validateConfig } from '../src/config/index.js';
import {
  createConfigRuntime,
  pickEditableSettings,
  serializeFileConfig,
  writeConfigFile,
} from '../src/config/runtime.js';
import { createViewServer } from '../src/server/index.js';

const silentLog = createLogger();
silentLog.level = 'silent';

function baseConfig(overrides = {}) {
  const config = structuredClone(DEFAULTS);
  config.ingest.authoritative.track = 'Cue';
  config.ingest.watchedTracks = ['Cue'];
  config.views = {
    band: { title: 'Band', fields: [{ column: 'Key' }] },
    admin: { title: 'Admin', system: true },
  };
  config.secrets = { googleServiceAccountKeyPath: null, sheetId: null };
  config.server.httpPort = 8080;
  return { ...config, ...overrides };
}

test('pickEditableSettings returns ingest, sim, sheets, match, timecode, moments, and oscOut', () => {
  const config = baseConfig();
  const settings = pickEditableSettings(config);
  assert.deepEqual(Object.keys(settings).sort(), ['ingest', 'match', 'moments', 'oscOut', 'sheets', 'sim', 'timecode']);
  assert.equal(settings.ingest.abletonHost, '127.0.0.1');
  assert.equal(settings.sim.enabled, false);
  assert.equal(settings.timecode.enabled, false);
  assert.equal(settings.moments.autoStartOnMoment, true);
  assert.equal(settings.oscOut.enabled, false);
  assert.deepEqual(settings.oscOut.destinations, []);
});

test('serializeFileConfig excludes secrets and env-only httpPort', () => {
  const config = baseConfig();
  config.secrets = { googleServiceAccountKeyPath: '/secret.json', sheetId: 'abc' };
  config.server.httpPort = 9090;

  const file = serializeFileConfig(config);
  assert.equal(file.secrets, undefined);
  assert.equal(file.server.httpPort, undefined);
  assert.equal(file.server.wsHeartbeatSeconds, DEFAULTS.server.wsHeartbeatSeconds);
  assert.ok(file.views.admin);
});

test('createConfigRuntime persists patch and invokes reload handlers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-config-'));
  const configPath = join(dir, 'config.json');
  const config = baseConfig({
    ingest: {
      ...DEFAULTS.ingest,
      abletonHost: '10.0.0.1',
      authoritative: { strategy: 'track', track: 'Cue' },
    },
  });
  validateConfig(config);
  writeConfigFile(configPath, config, dir);

  const reloaded = [];
  const runtime = createConfigRuntime({ config, configPath, cwd: dir, log: silentLog });
  runtime.onReload(async (sections) => { reloaded.push(sections); });

  const result = await runtime.updateSettings({
    ingest: { abletonHost: '192.168.1.50' },
    match: { threshold: 0.55 },
  });

  assert.equal(result.settings.ingest.abletonHost, '192.168.1.50');
  assert.equal(result.settings.match.threshold, 0.55);
  assert.deepEqual(reloaded[0].sort(), ['ingest', 'match']);

  const onDisk = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(onDisk.ingest.abletonHost, '192.168.1.50');
  assert.equal(onDisk.match.threshold, 0.55);

  rmSync(dir, { recursive: true, force: true });
});

test('createConfigRuntime rejects invalid patch', async () => {
  const config = baseConfig();
  const runtime = createConfigRuntime({ config, log: silentLog });

  await assert.rejects(
    () => runtime.updateSettings({ ingest: { oscListenPort: 99999 } }),
    /oscListenPort/
  );
});

test('GET and PATCH /api/config/settings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ableview-api-'));
  const configPath = join(dir, 'config.json');
  const config = baseConfig({
    ingest: {
      ...DEFAULTS.ingest,
      abletonHost: '10.0.0.2',
      watchedTracks: ['Cue'],
      authoritative: { strategy: 'track', track: 'Cue' },
    },
  });
  validateConfig(config);
  writeConfigFile(configPath, config, dir);

  const runtime = createConfigRuntime({ config, configPath, cwd: dir, log: silentLog });
  const bus = createBus();
  config.server.httpPort = 0;

  const server = await createViewServer({
    config,
    bus,
    log: silentLog,
    configRuntime: runtime,
  });

  const getRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.settings.ingest.abletonHost, '10.0.0.2');

  const patchRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ingest: { abletonHost: '192.168.0.99' } }),
  });
  assert.equal(patchRes.status, 200);
  const patchBody = await patchRes.json();
  assert.equal(patchBody.settings.ingest.abletonHost, '192.168.0.99');
  assert.deepEqual(patchBody.reloaded, ['ingest']);

  const simRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sim: { enabled: true } }),
  });
  assert.equal(simRes.status, 200);
  const simBody = await simRes.json();
  assert.equal(simBody.settings.sim.enabled, true);
  assert.deepEqual(simBody.reloaded, ['sim']);

  const tcRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timecode: { enabled: true, port: 6454, bindAddress: '0.0.0.0', staleMs: 500 },
    }),
  });
  assert.equal(tcRes.status, 200);
  const tcBody = await tcRes.json();
  assert.equal(tcBody.settings.timecode.enabled, true);
  assert.deepEqual(tcBody.reloaded, ['timecode']);

  const oscRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oscOut: {
        enabled: true,
        destinations: [{ host: '192.168.1.40', port: 9000 }],
      },
    }),
  });
  assert.equal(oscRes.status, 200);
  const oscBody = await oscRes.json();
  assert.equal(oscBody.settings.oscOut.enabled, true);
  assert.deepEqual(oscBody.settings.oscOut.destinations, [{ host: '192.168.1.40', port: 9000 }]);
  assert.deepEqual(oscBody.reloaded, ['oscOut']);

  const oscReplace = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      oscOut: {
        enabled: true,
        destinations: [{ host: '10.0.0.8', port: 8000 }],
      },
    }),
  });
  assert.equal(oscReplace.status, 200);
  const oscReplaceBody = await oscReplace.json();
  assert.deepEqual(oscReplaceBody.settings.oscOut.destinations, [{ host: '10.0.0.8', port: 8000 }]);

  const badRes = await fetch(`http://127.0.0.1:${server.port}/api/config/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ views: { band: { title: 'X' } } }),
  });
  assert.equal(badRes.status, 400);

  await server.stop();
  rmSync(dir, { recursive: true, force: true });
});

test('admin view HTML does not embed settings panel', async () => {
  const bus = createBus();
  const config = baseConfig();
  config.server.httpPort = 0;
  const server = await createViewServer({ config, bus, log: silentLog });

  const res = await fetch(`http://127.0.0.1:${server.port}/views/admin`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.doesNotMatch(html, /admin-settings\.js/);
  assert.doesNotMatch(html, /settings-panel/);

  await server.stop();
});

test('settings view HTML loads settings panel script', async () => {
  const bus = createBus();
  const config = baseConfig();
  config.server.httpPort = 0;
  const server = await createViewServer({ config, bus, log: silentLog });

  const res = await fetch(`http://127.0.0.1:${server.port}/views/settings`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /AbleView — Settings/);
  assert.match(html, /settingsActive: true/);
  assert.doesNotMatch(html, /statusOnly: true/);

  await server.stop();
});
