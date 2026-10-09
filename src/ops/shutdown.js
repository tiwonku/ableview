/** Bounded process shutdown. A second signal or a timeout always exits. */

export const SHUTDOWN_TIMEOUT_MS = 2000;

export function createShutdown(run, {
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  exit = (code) => process.exit(code),
  onForce,
} = {}) {
  let phase = 'idle';
  let timer = null;

  return function shutdown(signal) {
    if (phase !== 'idle') {
      if (timer) clearTimeout(timer);
      phase = 'forced';
      onForce?.('signal');
      exit(0);
      return;
    }

    phase = 'stopping';
    timer = setTimeout(() => {
      if (phase !== 'stopping') return;
      phase = 'forced';
      onForce?.('timeout');
      exit(0);
    }, timeoutMs);
    timer.unref?.();

    Promise.resolve()
      .then(() => run(signal))
      .catch(() => {})
      .finally(() => {
        if (phase !== 'stopping') return;
        phase = 'done';
        clearTimeout(timer);
        exit(0);
      });
  };
}
