import dgram from 'node:dgram';
import { EVENTS } from '../core/bus.js';
import {
  cloneSlotColors,
  makeLiveColorsStatus,
  maxChannelDelta,
} from '../core/live-colors.js';
import {
  extractSlotColors,
  multicastGroupForUniverse,
  parseE131DataPacket,
} from './e131.js';

function colorsChanged(a, b) {
  return maxChannelDelta(a, b) > 0;
}

export function createSacnListener({ getConfig, bus, log }) {
  let socket = null;
  let staleTimer = null;
  let live = false;
  let lastSeenAt = null;
  let lastColors = null;
  let lastUniverse = null;
  let lastSourceName = null;
  let lastSourceAddress = null;
  let lastPreview = false;

  function sacnConfig() {
    return getConfig().sacn ?? {};
  }

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
      emitStatus();
      log.info('sACN color signal went stale');
    }, staleMs);
    staleTimer.unref?.();
  }

  function emitStatus() {
    bus.emit(EVENTS.LIVE_COLORS, getStatus());
  }

  function markLive(staleMs) {
    const wasLive = live;
    live = true;
    lastSeenAt = Date.now();
    scheduleStaleCheck(staleMs);
    return !wasLive;
  }

  function onMessage(msg, rinfo) {
    const config = sacnConfig();
    if (config.enabled !== true) return;

    const parsed = parseE131DataPacket(msg);
    if (!parsed) return;
    if (parsed.universe !== (config.universe ?? 191)) return;
    if (parsed.startCode !== 0) return;
    if (parsed.terminated) return;
    if (config.ignorePreview !== false && parsed.preview) return;

    const colors = extractSlotColors(parsed.dmx, config.slots);
    const becameLive = markLive(config.staleMs ?? 1000);
    const rgbChanged = colorsChanged(lastColors, colors);

    lastColors = cloneSlotColors(colors);
    lastUniverse = parsed.universe;
    lastSourceName = parsed.sourceName || lastSourceName;
    lastSourceAddress = rinfo?.address ?? lastSourceAddress;
    lastPreview = parsed.preview === true;

    if (becameLive || rgbChanged) {
      if (becameLive) log.info({ universe: parsed.universe, from: rinfo?.address }, 'sACN color signal detected');
      emitStatus();
    }
  }

  function getStatus() {
    const config = sacnConfig();
    if (config.enabled !== true) {
      return makeLiveColorsStatus({ enabled: false });
    }
    return makeLiveColorsStatus({
      enabled: true,
      live,
      lastSeenAt,
      universe: lastUniverse ?? config.universe ?? 191,
      sourceName: lastSourceName,
      sourceAddress: lastSourceAddress,
      preview: lastPreview,
      colors: lastColors,
    });
  }

  async function start() {
    stop();
    const config = sacnConfig();
    if (config.enabled !== true) {
      log.info('sACN color listener disabled');
      emitStatus();
      return;
    }

    const port = config.port ?? 5568;
    const bindAddress = config.bindAddress ?? '0.0.0.0';
    const multicast = config.multicast !== false;
    const universe = config.universe ?? 191;
    const iface = config.interfaceAddress && config.interfaceAddress !== '0.0.0.0'
      ? config.interfaceAddress
      : undefined;

    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    socket.on('message', onMessage);
    socket.on('error', (err) => {
      log.error({ err: err.message }, 'sACN socket error');
    });

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, bindAddress, () => {
        socket.off('error', reject);
        resolve();
      });
    });

    if (multicast) {
      const group = multicastGroupForUniverse(universe);
      try {
        socket.addMembership(group, iface);
        if (iface) socket.setMulticastInterface(iface);
        log.info({ port, bindAddress, universe, group, interfaceAddress: iface ?? 'default' }, 'listening for sACN colors');
      } catch (err) {
        log.error(
          { err: err.message, group, interfaceAddress: iface ?? null },
          'sACN multicast join failed — pick the lighting NIC in settings',
        );
      }
    } else {
      log.info({ port, bindAddress, universe }, 'listening for sACN colors (unicast)');
    }
  }

  function stop() {
    clearStaleTimer();
    if (socket) {
      try { socket.close(); } catch { /* already closed */ }
      socket = null;
    }
    live = false;
  }

  function resetState() {
    lastColors = null;
    lastSeenAt = null;
    live = false;
    lastUniverse = null;
    lastSourceName = null;
    lastSourceAddress = null;
    lastPreview = false;
    emitStatus();
  }

  return {
    start,
    stop,
    getStatus,
    resetState,
  };
}
