import { createAbletonOscSource } from './sources/abletonosc.js';
import { createSimulatorSource } from './sources/simulator.js';
import { createOscEmitter } from '../sim/osc-emitter.js';

function resolveGetConfig({ config, getConfig }) {
  return getConfig ?? (() => config);
}

function buildSource({ getConfig, bus, log, getClipNames }) {
  const config = getConfig();

  if (!config.sim.enabled) {
    return {
      source: createAbletonOscSource({
        config,
        getIngestConfig: () => getConfig().ingest,
        bus,
        log: log.child({ module: 'ingest.abletonosc' }),
      }),
      simulated: false,
    };
  }

  if (config.sim.mode === 'osc') {
    const emitter = createOscEmitter({ config, log: log.child({ module: 'sim.osc-emitter' }) });
    const adapter = createAbletonOscSource({
      config: { ...config, ingest: { ...config.ingest, abletonHost: '127.0.0.1' } },
      getIngestConfig: () => ({ ...getConfig().ingest, abletonHost: '127.0.0.1' }),
      bus,
      log: log.child({ module: 'ingest.abletonosc' }),
    });
    return {
      source: {
        name: 'simulator',
        start: async () => { await emitter.start(); await adapter.start(); },
        stop: () => { adapter.stop(); emitter.stop(); },
      },
      simulated: true,
    };
  }

  return {
    source: createSimulatorSource({
      config,
      bus,
      log: log.child({ module: 'ingest.simulator' }),
      getClipNames,
    }),
    simulated: true,
  };
}

// Ingest interface (spec §3, §7): selects the active NowPlaying source.
export function createIngest({ config, getConfig, bus, log, getClipNames = null }) {
  const resolveConfig = resolveGetConfig({ config, getConfig });
  let active = null;
  let running = false;

  function recreate() {
    active?.source.stop();
    active = buildSource({ getConfig: resolveConfig, bus, log, getClipNames });
    return active;
  }

  return {
    get simulated() {
      return active?.simulated ?? resolveConfig().sim.enabled;
    },
    get source() {
      return active?.source ?? { name: 'pending', start: async () => {}, stop: () => {} };
    },
    async start() {
      recreate();
      await active.source.start();
      running = true;
    },
    stop() {
      active?.source.stop();
      running = false;
    },
    async reloadIngest() {
      if (!running) {
        recreate();
        return;
      }
      active.source.stop();
      recreate();
      await active.source.start();
    },
    isSimControlAvailable() {
      return active?.simulated === true;
    },
    canSimControl() {
      return active?.simulated === true && typeof active.source.fire === 'function';
    },
    fireSimClip(clipName, opts) {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.fire(clipName, opts);
    },
    clearSimClip() {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.clear();
    },
    getSimStatus() {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.getStatus();
    },
    getIngestStatus() {
      if (active?.simulated) return { live: true, lastSeenAt: Date.now() };
      return active?.source.getIngestStatus?.() ?? { live: false, lastSeenAt: null };
    },
    pauseSim() {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.pause();
    },
    resumeSim() {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.resume();
    },
    stepSim(direction) {
      if (!this.canSimControl()) {
        throw new Error('Manual sim controls require sim.enabled with sim.mode "internal"');
      }
      return active.source.step(direction);
    },
  };
}
