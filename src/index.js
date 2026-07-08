import { loadConfig, shouldValidateProduction, validateProductionReady } from './config/index.js';
import { createLogger } from './core/logger.js';
import { createBus } from './core/bus.js';
import { createIngest } from './ingest/index.js';
import { createSheetsStore } from './sheets/index.js';
import { createMatcher } from './match/index.js';
import { createViewServer } from './server/index.js';

const log = createLogger({ app: 'ableview' });

async function main() {
  const config = loadConfig();

  // `npm run sim` convenience: force simulation mode without editing config.
  if (process.argv.includes('--sim')) config.sim.enabled = true;

  if (shouldValidateProduction()) {
    validateProductionReady(config);
  }

  const bus = createBus();
  const simulated = config.sim.enabled;

  const sheets = createSheetsStore({ config, log: log.child({ module: 'sheets' }) });
  await sheets.start();

  createMatcher({
    config,
    bus,
    log: log.child({ module: 'match' }),
    getSnapshot: sheets.getSnapshot,
  });

  const viewServer = await createViewServer({
    config,
    bus,
    log: log.child({ module: 'server' }),
    getHealthContext: () => ({
      simulated,
      getSheetSnapshot: sheets.getSnapshot,
    }),
  });

  const { source } = createIngest({
    config,
    bus,
    log,
    getClipNames: sheets.getClipNames,
  });
  if (simulated) {
    log.warn('================ SIMULATION MODE ================');
  }

  await source.start();
  log.info({ source: source.name, simulated, httpPort: viewServer.port }, 'AbleView started');

  const shutdown = async (signal) => {
    log.info({ signal }, 'shutting down');
    source.stop();
    sheets.stop();
    await viewServer.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.fatal({ err: err.message }, 'fatal error on startup');
  process.exit(1);
});
