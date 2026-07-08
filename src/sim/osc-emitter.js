import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import osc from 'osc';

// sim.mode "osc": a minimal on-the-wire mock of AbletonOSC. Listens where
// Ableton would (oscSendPort, default 11000) and replies unicast to the
// requester's listen port, exercising the real abletonosc adapter end-to-end.
//
// It fakes a single-track set ("Cue") whose playing clip walks the scenario
// steps. Only the read/listen addresses the adapter uses are answered.
export function createOscEmitter({ config, log }) {
  const { oscSendPort, oscListenPort } = config.ingest;
  const { scenario, intervalSeconds } = config.sim;

  const TRACK_NAMES = ['Cue'];
  let udp = null;
  let timer = null;
  let stepIndex = 0;
  let slotIndex = -1;
  let clipName = null;
  let tempo = 120;
  let subscriber = null; // { address, port } of the listening AbleView instance

  function loadSteps() {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), scenario), 'utf8'));
    return { steps: parsed.steps ?? [], loop: parsed.loop ?? true };
  }

  function reply(to, address, args = []) {
    udp.send({ address, args }, to.address, to.port);
  }

  function onMessage(msg, _timeTag, info) {
    const from = { address: info.address, port: oscListenPort };
    switch (msg.address) {
      case '/live/song/get/track_names':
        return reply(from, '/live/song/get/track_names', TRACK_NAMES);
      case '/live/song/get/tempo':
      case '/live/song/start_listen/tempo':
        return reply(from, '/live/song/get/tempo', [tempo]);
      case '/live/track/start_listen/playing_slot_index':
        subscriber = from;
        return reply(from, '/live/track/get/playing_slot_index', [msg.args[0], slotIndex]);
      case '/live/track/get/playing_slot_index':
        return reply(from, '/live/track/get/playing_slot_index', [msg.args[0], slotIndex]);
      case '/live/clip/get/name':
        return reply(from, '/live/clip/get/name', [msg.args[0], msg.args[1], clipName ?? '']);
      default:
        return undefined; // listen-stop and unknown addresses need no reply
    }
  }

  function advance() {
    const { steps, loop } = loadSteps();
    if (steps.length === 0) return;
    if (stepIndex >= steps.length) {
      if (!loop) return;
      stepIndex = 0;
    }
    const step = steps[stepIndex];
    stepIndex += 1;
    clipName = step.clipName;
    slotIndex = stepIndex; // any non-negative slot means "playing"
    if (step.tempo) tempo = step.tempo;
    log.info({ clipName, slotIndex }, 'osc-emitter: fake clip launched');
    if (subscriber) {
      reply(subscriber, '/live/track/get/playing_slot_index', [0, slotIndex]);
    }
    timer = setTimeout(advance, (step.holdSeconds ?? intervalSeconds) * 1000);
    timer.unref?.();
  }

  function start() {
    return new Promise((resolvePromise, reject) => {
      udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: oscSendPort, metadata: false });
      udp.on('ready', () => {
        log.warn({ port: oscSendPort }, 'SIMULATION MODE (osc): mock AbletonOSC listening');
        advance();
        resolvePromise();
      });
      udp.on('message', onMessage);
      udp.on('error', (err) => reject(err));
      udp.open();
    });
  }

  function stop() {
    if (timer) clearTimeout(timer);
    if (udp) udp.close();
    udp = null;
  }

  return { start, stop };
}
