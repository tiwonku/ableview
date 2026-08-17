import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  validateConfig,
  validateProductionReady,
  shouldValidateProduction,
} from '../src/config/index.js';

function baseConfig() {
  const cfg = structuredClone(DEFAULTS);
  cfg.ingest.authoritative.track = 'Cue';
  cfg.server.httpPort = 8080;
  cfg.views = {
    band: { title: 'Band', fields: [{ column: 'Key' }] },
    admin: { title: 'Admin', system: true },
  };
  cfg.secrets = {
    googleServiceAccountKeyPath: './secrets/service-account.json',
    sheetId: 'abc123',
  };
  return cfg;
}

test('validateConfig rejects invalid HTTP_PORT and view fields', () => {
  const cfg = baseConfig();
  cfg.server.httpPort = 70000;
  cfg.views.band.fields = [{}];
  assert.throws(() => validateConfig(cfg), /HTTP_PORT[\s\S]*column/);
});

test('validateConfig allows source tempo fields without column', () => {
  const cfg = baseConfig();
  cfg.views.band.fields = [
    { source: 'tempo', label: 'Tempo' },
    { column: 'Key' },
  ];
  assert.equal(validateConfig(cfg), cfg);
});

test('validateConfig rejects unknown field source and source+column', () => {
  const cfg = baseConfig();
  cfg.views.band.fields = [{ source: 'beat' }];
  assert.throws(() => validateConfig(cfg), /source must be "tempo"/);

  cfg.views.band.fields = [{ source: 'tempo', column: 'BPM' }];
  assert.throws(() => validateConfig(cfg), /cannot set both source and column/);
});

test('validateConfig rejects oscOut destinations without host or port', () => {
  const cfg = baseConfig();
  cfg.oscOut = { enabled: true, destinations: [{ host: '', port: 9000 }] };
  assert.throws(() => validateConfig(cfg), /oscOut.destinations\[0\].host/);

  cfg.oscOut = { enabled: true, destinations: [{ host: '192.168.1.10', port: 0 }] };
  assert.throws(() => validateConfig(cfg), /oscOut.destinations\[0\].port/);
});

test('validateProductionReady requires sheet credentials when not simulating', () => {
  const cfg = baseConfig();
  cfg.sim.enabled = false;
  assert.equal(validateProductionReady(cfg), cfg);

  cfg.secrets.sheetId = null;
  assert.throws(() => validateProductionReady(cfg), /SHEET_ID/);
});

test('validateProductionReady skips sheet requirements in simulation mode', () => {
  const cfg = baseConfig();
  cfg.sim.enabled = true;
  cfg.secrets = { googleServiceAccountKeyPath: null, sheetId: null };
  assert.equal(validateProductionReady(cfg), cfg);
});

test('validateProductionReady requires admin system view', () => {
  const cfg = baseConfig();
  delete cfg.views.admin;
  assert.throws(() => validateProductionReady(cfg), /admin/);
});

test('shouldValidateProduction is false by default in tests', () => {
  assert.equal(shouldValidateProduction(), false);
});
