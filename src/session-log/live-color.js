import {
  cloneSlotColors,
  hasSlotColors,
  maxChannelDelta,
} from '../core/live-colors.js';

const LOG_DEFAULTS = Object.freeze({
  changeDelta: 4,
  settleMs: 200,
});

function readLogConfig(getLogConfig) {
  const raw = typeof getLogConfig === 'function' ? getLogConfig() : getLogConfig;
  return {
    changeDelta: raw?.changeDelta ?? LOG_DEFAULTS.changeDelta,
    settleMs: raw?.settleMs ?? LOG_DEFAULTS.settleMs,
  };
}

/**
 * Hybrid live_color records.
 * Logs the static look bus (settled holds) plus move/hold spans while FX
 * is changing. Falls back to settled FX-only holds when static is absent.
 */
export function createLiveColorGate({
  getLogConfig,
  onRecord,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let lastPacketLook = null;
  let lastPacketFx = null;
  let lastLoggedLook = null;
  let lastLoggedPhase = null;
  let lastLookMoveAt = 0;
  let lastFxMoveAt = 0;
  let latestLook = null;
  let latestFx = null;
  let latestMeta = null;
  let hasLookBus = false;
  let moving = false;
  let lookSettleTimer = null;
  let motionEndTimer = null;

  function clearLookSettle() {
    if (lookSettleTimer) {
      clearTimeoutFn(lookSettleTimer);
      lookSettleTimer = null;
    }
  }

  function clearMotionEnd() {
    if (motionEndTimer) {
      clearTimeoutFn(motionEndTimer);
      motionEndTimer = null;
    }
  }

  function emitHold({ colors } = {}) {
    const payload = {
      phase: 'hold',
      universe: latestMeta?.universe ?? null,
    };
    if (colors) {
      payload.colors = cloneSlotColors(colors);
      lastLoggedLook = cloneSlotColors(colors);
    }
    lastLoggedPhase = 'hold';
    onRecord?.(payload);
    return true;
  }

  function emitMove() {
    if (lastLoggedPhase === 'move') return false;
    lastLoggedPhase = 'move';
    moving = true;
    onRecord?.({
      phase: 'move',
      universe: latestMeta?.universe ?? null,
    });
    return true;
  }

  function lookChangedEnough(next) {
    const { changeDelta } = readLogConfig(getLogConfig);
    if (!lastLoggedLook) return true;
    return maxChannelDelta(lastLoggedLook, next) >= changeDelta;
  }

  function emitSettledLook() {
    if (!latestLook || !hasSlotColors(latestLook)) return false;
    if (!lookChangedEnough(latestLook)) return false;
    if (lastLoggedPhase === 'hold' && lastLoggedLook
      && maxChannelDelta(lastLoggedLook, latestLook) < 1) {
      return false;
    }
    return emitHold({ colors: latestLook });
  }

  function fxIsBusy() {
    const { settleMs } = readLogConfig(getLogConfig);
    return lastFxMoveAt > 0 && now() - lastFxMoveAt < settleMs;
  }

  function lookIsStable() {
    const { settleMs } = readLogConfig(getLogConfig);
    return lastLookMoveAt > 0 && now() - lastLookMoveAt >= settleMs;
  }

  function startMove() {
    if (!moving) emitMove();
    scheduleMotionEnd();
  }

  function scheduleMotionEnd() {
    if (!moving || motionEndTimer) return;
    const { settleMs } = readLogConfig(getLogConfig);
    motionEndTimer = setTimeoutFn(() => {
      motionEndTimer = null;
      if (fxIsBusy()) {
        scheduleMotionEnd();
        return;
      }
      moving = false;
      if (lastLoggedPhase === 'move') emitHold();
    }, settleMs);
    motionEndTimer.unref?.();
  }

  function evaluateMotion() {
    if (!hasLookBus) return;
    if (lookIsStable() && fxIsBusy()) {
      startMove();
      return;
    }
    if (moving && !fxIsBusy()) scheduleMotionEnd();
  }

  function scheduleLookSettle() {
    clearLookSettle();
    const { settleMs } = readLogConfig(getLogConfig);
    lookSettleTimer = setTimeoutFn(() => {
      lookSettleTimer = null;
      const { settleMs: wait } = readLogConfig(getLogConfig);
      if (now() - lastLookMoveAt < wait) {
        scheduleLookSettle();
        return;
      }
      emitSettledLook();
      evaluateMotion();
    }, settleMs);
    lookSettleTimer.unref?.();
  }

  function handleStatus(status) {
    if (!status || status.enabled !== true || status.live !== true) return;

    const lookSource = hasSlotColors(status.staticColors) ? status.staticColors : status.colors;
    if (!hasSlotColors(lookSource)) return;

    hasLookBus = hasSlotColors(status.staticColors);
    latestLook = cloneSlotColors(lookSource);
    latestFx = cloneSlotColors(status.colors);
    latestMeta = { universe: status.universe ?? null };

    const lookDelta = maxChannelDelta(lastPacketLook, latestLook);
    const fxDelta = maxChannelDelta(lastPacketFx, latestFx);
    lastPacketLook = cloneSlotColors(latestLook);
    lastPacketFx = cloneSlotColors(latestFx);

    if (lookDelta >= 1) {
      lastLookMoveAt = now();
      scheduleLookSettle();
    }
    if (hasLookBus && fxDelta >= 1) {
      lastFxMoveAt = now();
      if (moving) {
        clearMotionEnd();
        scheduleMotionEnd();
      }
    }

    evaluateMotion();
  }

  function reset() {
    clearLookSettle();
    clearMotionEnd();
    lastPacketLook = null;
    lastPacketFx = null;
    lastLoggedLook = null;
    lastLoggedPhase = null;
    lastLookMoveAt = 0;
    lastFxMoveAt = 0;
    latestLook = null;
    latestFx = null;
    latestMeta = null;
    hasLookBus = false;
    moving = false;
  }

  return {
    handleStatus,
    reset,
    stop: reset,
  };
}

export { LOG_DEFAULTS };
