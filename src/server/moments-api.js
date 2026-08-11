/** REST handlers for crew moment markers (M14). */

import {
  SessionLogDisabledError,
  UnknownKindError,
  WhoTooLongError,
  NoteTooLongError,
  MomentDebouncedError,
} from '../session-log/moments.js';

function mapMomentError(err, reply) {
  if (err instanceof SessionLogDisabledError) {
    return reply.code(409).send({
      error: err.code,
      message: err.message,
    });
  }
  if (err instanceof UnknownKindError) {
    return reply.code(400).send({ error: err.code, kind: err.kind });
  }
  if (err instanceof WhoTooLongError) {
    return reply.code(400).send({ error: err.code });
  }
  if (err instanceof NoteTooLongError) {
    return reply.code(400).send({ error: err.code });
  }
  if (err instanceof MomentDebouncedError) {
    return reply.code(429).send({
      error: err.code,
      retryAfterMs: Math.max(0, Math.ceil(err.retryAfterMs)),
    });
  }
  throw err;
}

export function registerMomentsRoutes(app, { sessionLog, log }) {
  app.get('/api/moments', async (_req, reply) => {
    return reply.send(sessionLog.getMomentsStatus());
  });

  app.post('/api/moments', async (req, reply) => {
    const body = req.body ?? {};
    try {
      const result = sessionLog.logMoment({
        kind: body.kind,
        who: body.who,
        note: body.note,
      });
      log.info(
        { kind: result.kind, who: result.who, sessionName: result.sessionName },
        'moment logged',
      );
      return reply.send(result);
    } catch (err) {
      return mapMomentError(err, reply);
    }
  });
}

export function buildSessionLogBroadcast(sessionLog) {
  const snap = sessionLog.getStatus();
  return {
    enabled: snap.enabled === true,
    sessionName: snap.sessionName ?? null,
    lastLoggedAt: snap.lastLoggedAt ?? null,
  };
}
