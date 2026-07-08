import pino from 'pino';

export function createLogger(bindings = {}) {
  return pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: undefined,
  }).child(bindings);
}
