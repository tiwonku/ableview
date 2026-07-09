import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import osc from 'osc';

const NOTHING_PLAYING = -1;

// sim.mode "osc": a minimal on-the-wire mock of AbletonOSC. Listens where
// Ableton would (oscSendPort, default 11000) and replies unicast to the
// requester's listen port, exercising the real abletonosc adapter end-to-end.
//
// It fakes a single-track set ("Cue") whose clips fire first (fired slot),
// then play after quantDelaySeconds — matching Live's launch quantization.
export function createOscEmitter({ config, log }) {
  const { oscSendPort, oscListenPort } = config.ingest;
  const { scenario, intervalSeconds, quantDelaySeconds = 1 } = config.sim;

  const TRACK_NAMES = ['Cue'];
  let udp = null;
  let timer = null;
  let quantTimer = null;
  let stepIndex = 0;
  let playingSlotIndex = NOTHING_PLAYING;
  let firedSlotIndex = NOTHING_PLAYING;
  /** slotIndex -> clipName */
  const slotClips = new Map();
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
        return reply(from, '/live/track/get/playing_slot_index', [msg.args[0], playingSlotIndex]);
      case '/live/track/get/playing_slot_index':
        return reply(from, '/live/track/get/playing_slot_index', [msg.args[0], playingSlotIndex]);
      case '/live/track/start_listen/fired_slot_index':
        subscriber = from;
        return reply(from, '/live/track/get/fired_slot_index', [msg.args[0], firedSlotIndex]);
      case '/live/track/get/fired_slot_index':
        return reply(from, '/live/track/get/fired_slot_index', [msg.args[0], firedSlotIndex]);
      case '/live/clip/get/name': {
        const name = slotClips.get(msg.args[1]) ?? '';
        return reply(from, '/live/clip/get/name', [msg.args[0], msg.args[1], name]);
      }
      default:
        return undefined; // listen-stop and unknown addresses need no reply
    }
  }

  function notifySubscriber() {
    if (!subscriber) return;
    reply(subscriber, '/live/track/get/fired_slot_index', [0, firedSlotIndex]);
    reply(subscriber, '/live/track/get/playing_slot_index', [0, playingSlotIndex]);
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
    firedSlotIndex = stepIndex;
    slotClips.set(firedSlotIndex, step.clipName);
    if (step.tempo) tempo = step.tempo;
    log.info({ clipName: step.clipName, firedSlotIndex, quantDelaySeconds }, 'osc-emitter: fake clip fired');
    notifySubscriber();

    if (quantTimer) clearTimeout(quantTimer);
    quantTimer = setTimeout(() => {
      playingSlotIndex = firedSlotIndex;
      firedSlotIndex = NOTHING_PLAYING;
      log.info({ clipName: slotClips.get(playingSlotIndex), playingSlotIndex }, 'osc-emitter: fake clip now playing');
      notifySubscriber();
    }, quantDelaySeconds * 1000);
    quantTimer.unref?.();

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
    if (quantTimer) clearTimeout(quantTimer);
    if (udp) udp.close();
    udp = null;
  }

  return { start, stop };
}
