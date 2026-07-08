import { loadConfig } from './config/index.js';
import { createLogger } from './core/logger.js';
import { createBus, EVENTS } from './core/bus.js';
import { createIngest } from './ingest/index.js';

const log = createLogger({ app: 'ableview' });

async function main() {
  const config = loadConfig();

  // `npm run sim` convenience: force simulation mode without editing config.
  if (process.argv.includes('--sim')) config.sim.enabled = true;

  const bus = createBus();

  // Tap point for the view server (M4) and future outputs (§11).
  bus.on(EVENTS.NOW_PLAYING, (event) => {
    log.debug({ event }, 'NowPlaying event on bus');
  });

  const { source, simulated } = createIngest({ config, bus, log });
  if (simulated) {
    log.warn('================ SIMULATION MODE ================');
  }

  await source.start();
  log.info({ source: source.name, simulated }, 'AbleView started');

  const shutdown = (signal) => {
    log.info({ signal }, 'shutting down');
    source.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err: err.message }, 'fatal error on startup');
  process.exit(1);
});
