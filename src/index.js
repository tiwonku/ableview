import { loadConfig, shouldValidateProduction, validateProductionReady } from './config/index.js';
import { createConfigRuntime } from './config/runtime.js';
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

  const configRuntime = createConfigRuntime({ config, log: log.child({ module: 'config' }) });
  const getConfig = () => configRuntime.getConfig();

  const bus = createBus();

  const sheets = createSheetsStore({ getConfig, log: log.child({ module: 'sheets' }) });
  await sheets.start();

  const matcher = createMatcher({
    getConfig,
    bus,
    log: log.child({ module: 'match' }),
    getSnapshot: sheets.getSnapshot,
  });

  const ingest = createIngest({
    getConfig,
    bus,
    log,
    getClipNames: sheets.getClipNames,
  });

  const viewServer = await createViewServer({
    config,
    bus,
    log: log.child({ module: 'server' }),
    configRuntime,
    sheetsActions: {
      sync: () => sheets.sync(),
      getSnapshot: sheets.getSnapshot,
      onSynced: () => matcher.rematch(),
    },
    getHealthContext: () => ({
      simulated: ingest.simulated,
      getSheetSnapshot: sheets.getSnapshot,
    }),
  });

  configRuntime.onReload(async (sections) => {
    if (sections.includes('sim') || sections.includes('ingest')) {
      await ingest.reloadIngest();
      if (getConfig().sim.enabled) {
        log.warn('================ SIMULATION MODE ================');
      } else {
        log.info('simulation mode disabled — listening for live Ableton');
      }
    }
    if (sections.includes('sheets')) {
      sheets.applySettings();
      matcher.rematch();
    }
    if (sections.includes('match') || sections.includes('sim')) matcher.rematch();
  });

  if (ingest.simulated) {
    log.warn('================ SIMULATION MODE ================');
  }

  await ingest.start();
  log.info({ source: ingest.source.name, simulated: ingest.simulated, httpPort: viewServer.port }, 'AbleView started');

  const shutdown = async (signal) => {
    log.info({ signal }, 'shutting down');
    ingest.stop();
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
