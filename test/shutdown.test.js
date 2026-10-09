import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShutdown } from '../src/ops/shutdown.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('shutdown runs cleanup once then exits', async () => {
  const order = [];
  const shutdown = createShutdown(async () => {
    order.push('run');
    await delay(20);
  }, {
    timeoutMs: 1000,
    exit: () => order.push('exit'),
  });

  shutdown('SIGTERM');
  await delay(60);
  assert.deepEqual(order, ['run', 'exit']);
});

test('second signal exits without waiting for cleanup', async () => {
  const codes = [];
  let releases = 0;
  const shutdown = createShutdown(() => new Promise(() => {}), {
    timeoutMs: 5000,
    exit: (code) => codes.push(code),
    onForce: () => { releases += 1; },
  });

  shutdown('SIGINT');
  shutdown('SIGINT');
  assert.deepEqual(codes, [0]);
  assert.equal(releases, 1);
});

test('shutdown exits on timeout when cleanup hangs', async () => {
  let code = null;
  let reason = null;
  const shutdown = createShutdown(() => new Promise(() => {}), {
    timeoutMs: 30,
    exit: (value) => { code = value; },
    onForce: (why) => { reason = why; },
  });

  shutdown('SIGINT');
  await delay(80);
  assert.equal(code, 0);
  assert.equal(reason, 'timeout');
});
