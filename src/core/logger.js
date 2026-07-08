import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pino from 'pino';

function createDestination() {
  const logFile = process.env.LOG_FILE;
  if (!logFile) return undefined;

  const destPath = resolve(process.cwd(), logFile);
  mkdirSync(dirname(destPath), { recursive: true });
  return pino.destination({ dest: destPath, sync: false });
}

export function createLogger(bindings = {}) {
  const destination = createDestination();
  const logger = pino(
    {
      level: process.env.LOG_LEVEL ?? 'info',
      base: undefined,
    },
    destination
  );
  return logger.child(bindings);
}
