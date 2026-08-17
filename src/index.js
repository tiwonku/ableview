import { loadConfig, shouldValidateProduction, validateProductionReady } from './config/index.js';
import { createConfigRuntime } from './config/runtime.js';
import { createLogger } from './core/logger.js';
import { createBus } from './core/bus.js';
import { createIngest } from './ingest/index.js';
import { createSheetsStore } from './sheets/index.js';
import { createMatcher } from './match/index.js';
import { createViewServer } from './server/index.js';
import { createTimecodeListener } from './timecode/index.js';
import { createOscOutput } from './outputs/osc.js';
import { createSessionLogger } from './session-log/index.js';

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

  const timecode = createTimecodeListener({
    getConfig,
    bus,
    log: log.child({ module: 'timecode' }),
  });

  const oscOut = createOscOutput({
    getConfig,
    bus,
    log: log.child({ module: 'osc-out' }),
  });

  const sessionLog = createSessionLogger({
    bus,
    getConfig,
    getTimecodeStatus: () => timecode.getStatus(),
    getSimulated: () => ingest.simulated,
    log: log.child({ module: 'session-log' }),
  });

  const viewServer = await createViewServer({
    config,
    bus,
    log: log.child({ module: 'server' }),
    configRuntime,
    sheetsActions: {
      sync: () => sheets.sync(),
      updateRow: (rowId, changes) => sheets.updateRow(rowId, changes),
      appendRow: (changes) => sheets.appendRow(changes),
      appendAlias: (rowId, alias) => sheets.appendAlias(rowId, alias),
      searchRows: (query, opts) => sheets.searchRows(query, opts),
      getSnapshot: sheets.getSnapshot,
      onSynced: () => matcher.rematch(),
    },
    simActions: {
      isAvailable: () => ingest.isSimControlAvailable(),
      canControl: () => ingest.canSimControl(),
      fire: (clipName, opts) => ingest.fireSimClip(clipName, opts),
      clear: () => ingest.clearSimClip(),
      getStatus: () => ingest.getSimStatus(),
      pause: () => ingest.pauseSim(),
      resume: () => ingest.resumeSim(),
      step: (direction) => ingest.stepSim(direction),
    },
    getHealthContext: () => ({
      simulated: ingest.simulated,
      getSheetSnapshot: sheets.getSnapshot,
      getIngestStatus: () => ingest.getIngestStatus(),
      getTimecodeStatus: () => timecode.getStatus(),
    }),
    sessionLog,
  });

  sessionLog.start();

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
    if (sections.includes('timecode')) {
      try {
        await timecode.start();
      } catch (err) {
        log.error(
          { err: err.message, bindAddress: getConfig().timecode?.bindAddress, port: getConfig().timecode?.port },
          'timecode listener failed to restart — check listen IP/port (use 0.0.0.0 unless this PC has multiple NICs)',
        );
      }
    }
    if (sections.includes('oscOut')) {
      try {
        await oscOut.start();
      } catch (err) {
        log.error({ err: err.message }, 'osc clock output failed to restart');
      }
    }
    if (sections.includes('sim')) viewServer.rebroadcastSimState();
  });

  if (ingest.simulated) {
    log.warn('================ SIMULATION MODE ================');
  }

  try {
    await oscOut.start();
  } catch (err) {
    log.error({ err: err.message }, 'osc clock output failed to start');
  }
  await ingest.start();
  try {
    await timecode.start();
  } catch (err) {
    log.error(
      { err: err.message, bindAddress: getConfig().timecode?.bindAddress, port: getConfig().timecode?.port },
      'timecode listener failed to start — check listen IP/port (use 0.0.0.0 unless this PC has multiple NICs)',
    );
  }
  log.info({ source: ingest.source.name, simulated: ingest.simulated, httpPort: viewServer.port }, 'AbleView started');

  const shutdown = async (signal) => {
    log.info({ signal }, 'shutting down');
    sessionLog.stop();
    oscOut.stop();
    timecode.stop();
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
