import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyNodeProcess,
  extrasToStop,
  formatProcLine,
} from '../src/ops/ableview-procs.js';

test('classifyNodeProcess keeps live :8080 and marks sims extra', () => {
  const live = classifyNodeProcess({
    pid: 10,
    commandLine: 'node src/index.js',
    listenPorts: [8080],
  });
  const sim = classifyNodeProcess({
    pid: 11,
    commandLine: 'node src/index.js --sim',
    listenPorts: [8094],
  });
  const npmSim = classifyNodeProcess({
    pid: 12,
    commandLine: '"C:\\Program Files\\nodejs\\node.exe" npm-cli.js run sim',
    listenPorts: [],
  });
  const other = classifyNodeProcess({
    pid: 13,
    commandLine: 'node some-other.js',
    listenPorts: [3000],
  });

  assert.equal(live.keep, true);
  assert.equal(live.kind, 'live');
  assert.equal(sim.keep, false);
  assert.equal(sim.kind, 'sim');
  assert.equal(npmSim.keep, false);
  assert.equal(npmSim.kind, 'npm-sim');
  assert.equal(other, null);
});

test('extrasToStop returns only leftover AbleView processes', () => {
  const extras = extrasToStop([
    { pid: 10, commandLine: 'node src/index.js', listenPorts: [8080] },
    { pid: 11, commandLine: 'node src/index.js --sim', listenPorts: [8094] },
    { pid: 12, commandLine: 'node src\\index.js --sim', listenPorts: [8092] },
  ]);
  assert.deepEqual(extras.map((p) => p.pid), [11, 12]);
  assert.match(formatProcLine(extras[0]), /11\t:8094\tsim\textra/);
});
