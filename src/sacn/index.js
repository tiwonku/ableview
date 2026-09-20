import dgram from 'node:dgram';
import { EVENTS } from '../core/bus.js';
import {
  cloneSlotColors,
  isFxDivergedFromLook,
  makeLiveColorsStatus,
  maxChannelDelta,
  resolveSacnUniverses,
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
  let lastFxSeenAt = null;
  let lastStaticSeenAt = null;
  let lastColors = null;
  let lastStaticColors = null;
  let lastUniverse = null;
  let lastStaticUniverse = null;
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

  function busFresh(seenAt, staleMs, now) {
    if (seenAt == null) return false;
    if (!(staleMs > 0)) return true;
    return now - seenAt < staleMs;
  }

  function nextStaleWait(staleMs, now) {
    if (!(staleMs > 0)) return 0;
    const waits = [lastFxSeenAt, lastStaticSeenAt]
      .filter((at) => at != null)
      .map((at) => staleMs - (now - at))
      .filter((wait) => wait > 0);
    if (!waits.length) return staleMs;
    return Math.max(20, Math.min(...waits));
  }

  function applyLiveFlags(staleMs, now = Date.now()) {
    const fxLive = busFresh(lastFxSeenAt, staleMs, now);
    const staticLive = busFresh(lastStaticSeenAt, staleMs, now);
    const next = fxLive || staticLive;
    const changed = next !== live;
    live = next;
    return { fxLive, staticLive, changed };
  }

  function scheduleStaleCheck(staleMs) {
    clearStaleTimer();
    if (!(staleMs > 0)) return;
    const wait = nextStaleWait(staleMs, Date.now());
    staleTimer = setTimeout(() => {
      staleTimer = null;
      const { changed } = applyLiveFlags(staleMs);
      if (changed) {
        if (!live) log.info('sACN color signal went stale');
        emitStatus();
      }
      if (live) scheduleStaleCheck(staleMs);
    }, wait);
    staleTimer.unref?.();
  }

  function emitStatus() {
    bus.emit(EVENTS.LIVE_COLORS, getStatus());
  }

  function onMessage(msg, rinfo) {
    const config = sacnConfig();
    if (config.enabled !== true) return;

    const parsed = parseE131DataPacket(msg);
    if (!parsed) return;
    const { universe: fxUniverse, staticUniverse: lookUniverse } = resolveSacnUniverses(config);
    const isFx = parsed.universe === fxUniverse;
    const isLook = parsed.universe === lookUniverse;
    if (!isFx && !isLook) return;
    if (parsed.startCode !== 0) return;
    if (parsed.terminated) return;
    if (config.ignorePreview !== false && parsed.preview) return;

    const now = Date.now();
    let colors = lastColors;
    let staticColors = lastStaticColors;
    if (isFx) {
      colors = extractSlotColors(parsed.dmx, config.slots);
      lastFxSeenAt = now;
      lastUniverse = parsed.universe;
    }
    if (isLook) {
      staticColors = extractSlotColors(parsed.dmx, config.staticSlots);
      lastStaticSeenAt = now;
      lastStaticUniverse = parsed.universe;
    }

    const staleMs = config.staleMs ?? 1000;
    const wasLive = live;
    applyLiveFlags(staleMs, now);
    const rgbChanged = colorsChanged(lastColors, colors)
      || colorsChanged(lastStaticColors, staticColors);

    lastColors = cloneSlotColors(colors);
    lastStaticColors = cloneSlotColors(staticColors);
    lastSeenAt = now;
    lastSourceName = parsed.sourceName || lastSourceName;
    lastSourceAddress = rinfo?.address ?? lastSourceAddress;
    lastPreview = parsed.preview === true;
    scheduleStaleCheck(staleMs);

    if (!wasLive || rgbChanged) {
      if (!wasLive) {
        log.info(
          { universe: parsed.universe, from: rinfo?.address },
          'sACN color signal detected',
        );
      }
      emitStatus();
    }
  }

  function getStatus() {
    const config = sacnConfig();
    if (config.enabled !== true) {
      return makeLiveColorsStatus({ enabled: false });
    }
    const { universe, staticUniverse } = resolveSacnUniverses(config);
    const staleMs = config.staleMs ?? 1000;
    const { fxLive, staticLive } = applyLiveFlags(staleMs);
    return makeLiveColorsStatus({
      enabled: true,
      live,
      lastSeenAt,
      universe: lastUniverse ?? universe,
      staticUniverse: lastStaticUniverse ?? staticUniverse,
      sourceName: lastSourceName,
      sourceAddress: lastSourceAddress,
      preview: lastPreview,
      colors: lastColors,
      staticColors: lastStaticColors,
      fxLive,
      staticLive,
      moving: fxLive && staticLive && isFxDivergedFromLook(lastColors, lastStaticColors, {
        changeDelta: config.log?.changeDelta ?? 4,
      }),
    });
  }

  async function joinUniverse(universe, iface) {
    const group = multicastGroupForUniverse(universe);
    socket.addMembership(group, iface);
    return group;
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
    const { universe, staticUniverse } = resolveSacnUniverses(config);
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
      const universes = [...new Set([universe, staticUniverse])];
      const groups = [];
      try {
        for (const u of universes) {
          groups.push(await joinUniverse(u, iface));
        }
        if (iface) socket.setMulticastInterface(iface);
        log.info(
          { port, bindAddress, universe, staticUniverse, groups, interfaceAddress: iface ?? 'default' },
          'listening for sACN colors',
        );
      } catch (err) {
        log.error(
          { err: err.message, groups, interfaceAddress: iface ?? null },
          'sACN multicast join failed — pick the lighting NIC in settings',
        );
      }
    } else {
      log.info({ port, bindAddress, universe, staticUniverse }, 'listening for sACN colors (unicast)');
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
    lastStaticColors = null;
    lastSeenAt = null;
    lastFxSeenAt = null;
    lastStaticSeenAt = null;
    live = false;
    lastUniverse = null;
    lastStaticUniverse = null;
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
