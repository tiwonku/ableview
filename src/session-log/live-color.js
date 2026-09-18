import { cloneSlotColors, maxChannelDelta } from '../core/live-colors.js';

const LOG_DEFAULTS = Object.freeze({
  changeDelta: 4,
  settleMs: 200,
  motionIntervalMs: 400,
  minIntervalMs: 100,
});

function readLogConfig(getLogConfig) {
  const raw = typeof getLogConfig === 'function' ? getLogConfig() : getLogConfig;
  return {
    changeDelta: raw?.changeDelta ?? LOG_DEFAULTS.changeDelta,
    settleMs: raw?.settleMs ?? LOG_DEFAULTS.settleMs,
    motionIntervalMs: raw?.motionIntervalMs ?? LOG_DEFAULTS.motionIntervalMs,
    minIntervalMs: raw?.minIntervalMs ?? LOG_DEFAULTS.minIntervalMs,
  };
}

/**
 * Change-gated live_color records.
 * UI paints every packet separately; this only writes settled looks and
 * sparse motion samples while color is still moving (chases / fades).
 */
export function createLiveColorGate({
  getLogConfig,
  onRecord,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let lastPacketColors = null;
  let lastLoggedColors = null;
  let lastLoggedAt = 0;
  let lastLoggedReason = null;
  let lastMoveAt = 0;
  let latestColors = null;
  let latestMeta = null;
  let settleTimer = null;
  let motionTimer = null;

  function clearSettle() {
    if (settleTimer) {
      clearTimeoutFn(settleTimer);
      settleTimer = null;
    }
  }

  function clearMotion() {
    if (motionTimer) {
      clearTimeoutFn(motionTimer);
      motionTimer = null;
    }
  }

  function emit(reason) {
    if (!latestColors) return false;
    const { minIntervalMs, changeDelta } = readLogConfig(getLogConfig);
    const t = now();
    const sameAsLast = lastLoggedColors && maxChannelDelta(lastLoggedColors, latestColors) < 1;
    const closeToLast = lastLoggedColors && maxChannelDelta(lastLoggedColors, latestColors) < changeDelta;

    if (reason === 'motion') {
      if (t - lastLoggedAt < minIntervalMs) return false;
      if (sameAsLast) return false;
    } else if (reason === 'settled') {
      if (lastLoggedReason === 'settled' && closeToLast) return false;
    } else {
      return false;
    }

    lastLoggedColors = cloneSlotColors(latestColors);
    lastLoggedAt = t;
    lastLoggedReason = reason;
    onRecord?.({
      reason,
      colors: cloneSlotColors(latestColors),
      universe: latestMeta?.universe ?? null,
    });
    return true;
  }

  function startMotion() {
    if (motionTimer) return;
    const tick = () => {
      motionTimer = null;
      const { motionIntervalMs, settleMs, changeDelta } = readLogConfig(getLogConfig);
      if (now() - lastMoveAt >= settleMs) return;
      if (lastLoggedColors && maxChannelDelta(lastLoggedColors, latestColors) < changeDelta) return;
      emit('motion');
      motionTimer = setTimeoutFn(tick, motionIntervalMs);
      motionTimer.unref?.();
    };
    const { motionIntervalMs } = readLogConfig(getLogConfig);
    motionTimer = setTimeoutFn(tick, motionIntervalMs);
    motionTimer.unref?.();
  }

  function scheduleSettle() {
    clearSettle();
    const { settleMs } = readLogConfig(getLogConfig);
    settleTimer = setTimeoutFn(() => {
      settleTimer = null;
      const { settleMs: wait } = readLogConfig(getLogConfig);
      if (now() - lastMoveAt < wait) {
        scheduleSettle();
        return;
      }
      clearMotion();
      emit('settled');
    }, settleMs);
    settleTimer.unref?.();
  }

  function handleStatus(status) {
    if (!status || status.enabled !== true || status.live !== true || !status.colors) return;

    const { changeDelta } = readLogConfig(getLogConfig);
    latestColors = cloneSlotColors(status.colors);
    latestMeta = { universe: status.universe ?? null };

    const packetDelta = maxChannelDelta(lastPacketColors, latestColors);
    const loggedDelta = maxChannelDelta(lastLoggedColors, latestColors);
    lastPacketColors = cloneSlotColors(latestColors);

    if (packetDelta < 1) return;
    if (lastLoggedColors && loggedDelta < changeDelta) return;

    lastMoveAt = now();
    scheduleSettle();
    startMotion();
  }

  function reset() {
    clearSettle();
    clearMotion();
    lastPacketColors = null;
    lastLoggedColors = null;
    lastLoggedAt = 0;
    lastLoggedReason = null;
    lastMoveAt = 0;
    latestColors = null;
    latestMeta = null;
  }

  return {
    handleStatus,
    reset,
    stop: reset,
  };
}

export { LOG_DEFAULTS };
