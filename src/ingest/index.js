import { createAbletonOscSource } from './sources/abletonosc.js';
import { createSimulatorSource } from './sources/simulator.js';
import { createOscEmitter } from '../sim/osc-emitter.js';

// Ingest interface (spec §3, §7): selects the active NowPlaying source.
//
//   sim disabled          → real AbletonOSC listener
//   sim internal (default)→ simulator feeds the event bus directly
//   sim osc               → mock AbletonOSC on the wire + the REAL adapter,
//                           exercising the actual OSC listener path
export function createIngest({ config, bus, log, getClipNames = null }) {
  if (!config.sim.enabled) {
    return {
      source: createAbletonOscSource({ config, bus, log: log.child({ module: 'ingest.abletonosc' }) }),
      simulated: false,
    };
  }

  if (config.sim.mode === 'osc') {
    const emitter = createOscEmitter({ config, log: log.child({ module: 'sim.osc-emitter' }) });
    const adapter = createAbletonOscSource({
      config: { ...config, ingest: { ...config.ingest, abletonHost: '127.0.0.1' } },
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
    source: createSimulatorSource({ config, bus, log: log.child({ module: 'ingest.simulator' }), getClipNames }),
    simulated: true,
  };
}
