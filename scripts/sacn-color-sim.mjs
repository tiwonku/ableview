// Send the fixed GrandMA look to the local AbleView listener. Ctrl+C to stop.
// Does not write config and does not join the lighting multicast group.

import { loadConfig } from '../src/config/index.js';
import { createSacnLoopback, colorSimUniverses } from '../src/sacn/loopback.js';

const loaded = loadConfig();
const sacn = {
  ...loaded.sacn,
  enabled: true,
  sim: { enabled: true },
};

if (loaded.sacn?.enabled !== true) {
  console.warn('sACN listener is off in config. Packets go out, but AbleView ignores them until the listener is enabled.');
}

const loop = createSacnLoopback({
  getConfig: () => ({ sacn }),
  log: { info: (obj, msg) => console.log(msg ?? 'sACN color sim', obj) },
  unref: false,
});

loop.start();
const universes = colorSimUniverses(sacn).join(', ');
console.log(`Color sim → 127.0.0.1:${sacn.port ?? 5568} universe ${universes}. Ctrl+C to stop.`);

function shutdown() {
  loop.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
