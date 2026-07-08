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
