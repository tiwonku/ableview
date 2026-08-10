import dgram from 'node:dgram';
import { EVENTS } from '../core/bus.js';
import { makeTimecodeStatus } from '../core/timecode.js';
import { parseArtTimeCodePacket } from './artnet.js';

export function createTimecodeListener({ getConfig, bus, log }) {
  let socket = null;
  let staleTimer = null;
  let lastTimecode = null;
  let lastSeenAt = null;
  let live = false;

  function clearStaleTimer() {
    if (staleTimer) {
      clearTimeout(staleTimer);
      staleTimer = null;
    }
  }

  function scheduleStaleCheck(staleMs) {
    clearStaleTimer();
    if (!(staleMs > 0)) return;
    staleTimer = setTimeout(() => {
      staleTimer = null;
      if (!live) return;
      live = false;
      bus.emit(EVENTS.TIMECODE, getStatus());
    }, staleMs);
    staleTimer.unref?.();
  }

  function markLive(staleMs) {
    const wasLive = live;
    live = true;
    lastSeenAt = Date.now();
    scheduleStaleCheck(staleMs);
    if (!wasLive) {
      log.info('Art-Net timecode signal detected');
    }
  }

  function onMessage(msg) {
    const config = getConfig().timecode ?? {};
    if (config.enabled !== true) return;

    const parsed = parseArtTimeCodePacket(msg);
    if (!parsed) return;

    lastTimecode = parsed;
    markLive(config.staleMs ?? 500);
    bus.emit(EVENTS.TIMECODE, getStatus());
  }

  function getStatus() {
    const config = getConfig().timecode ?? {};
    if (config.enabled !== true) {
      return makeTimecodeStatus({ enabled: false });
    }
    return makeTimecodeStatus({
      enabled: true,
      live,
      lastSeenAt,
      timecode: lastTimecode,
    });
  }

  async function start() {
    stop();
    const config = getConfig().timecode ?? {};
    if (config.enabled !== true) {
      log.info('timecode listener disabled');
      return;
    }

    const port = config.port ?? 6454;
    const bindAddress = config.bindAddress ?? '0.0.0.0';

    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', onMessage);
    socket.on('error', (err) => {
      log.error({ err: err.message }, 'timecode socket error');
    });

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, bindAddress, () => {
        socket.off('error', reject);
        resolve();
      });
    });

    log.info({ port, bindAddress }, 'listening for Art-Net timecode');
  }

  function stop() {
    clearStaleTimer();
    if (socket) {
      socket.close();
      socket = null;
    }
    live = false;
  }

  function resetState() {
    lastTimecode = null;
    lastSeenAt = null;
    live = false;
    bus.emit(EVENTS.TIMECODE, getStatus());
  }

  return {
    start,
    stop,
    getStatus,
    resetState,
  };
}
