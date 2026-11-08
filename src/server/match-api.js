/** Temporary cue pin: show a sheet row until the next automatic match. */

export function registerMatchRoutes(app, { matchActions, log }) {
  app.post('/api/match/override', async (req, reply) => {
    const rowId = req.body?.rowId;
    if (rowId == null || String(rowId).trim() === '') {
      return reply.code(400).send({ ok: false, error: 'body.rowId is required' });
    }
    if (typeof matchActions?.setOverride !== 'function') {
      return reply.code(501).send({ ok: false, error: 'match override is not available' });
    }
    try {
      const status = matchActions.setOverride(rowId);
      log.info({ rowId: status.rowId, applied: status.applied, queued: status.queued }, 'cue pin set');
      return reply.send({ ok: true, ...status });
    } catch (err) {
      const message = err.message ?? 'override failed';
      const code = /row not found|rowId is required/i.test(message) ? 400 : 502;
      log.warn({ err: message, rowId }, 'cue pin failed');
      return reply.code(code).send({ ok: false, error: message });
    }
  });

  app.delete('/api/match/override', async (_req, reply) => {
    if (typeof matchActions?.clearOverride !== 'function') {
      return reply.code(501).send({ ok: false, error: 'match override is not available' });
    }
    const status = matchActions.clearOverride();
    log.info('cue pin cleared');
    return reply.send({ ok: true, ...status });
  });

  app.get('/api/match/deadlist', async (_req, reply) => {
    if (typeof matchActions?.listDeadlist !== 'function') {
      return reply.code(501).send({ ok: false, error: 'match deadlist is not available' });
    }
    return reply.send({ ok: true, clips: matchActions.listDeadlist() });
  });

  app.post('/api/match/deadlist', async (req, reply) => {
    const clipName = req.body?.clipName;
    if (clipName == null || String(clipName).trim() === '') {
      return reply.code(400).send({ ok: false, error: 'body.clipName is required' });
    }
    if (typeof matchActions?.addDeadlist !== 'function') {
      return reply.code(501).send({ ok: false, error: 'match deadlist is not available' });
    }
    try {
      const clips = matchActions.addDeadlist(clipName);
      log.info({ clipName: String(clipName).trim(), count: clips.length }, 'clip deadlisted');
      return reply.send({ ok: true, clips });
    } catch (err) {
      const message = err.message ?? 'deadlist failed';
      const code = /required|empty after normalize|full/i.test(message) ? 400 : 502;
      log.warn({ err: message, clipName }, 'clip deadlist failed');
      return reply.code(code).send({ ok: false, error: message });
    }
  });

  app.delete('/api/match/deadlist', async (req, reply) => {
    const norm = req.body?.norm ?? req.body?.clipName;
    if (norm == null || String(norm).trim() === '') {
      return reply.code(400).send({ ok: false, error: 'body.norm is required' });
    }
    if (typeof matchActions?.removeDeadlist !== 'function') {
      return reply.code(501).send({ ok: false, error: 'match deadlist is not available' });
    }
    try {
      const clips = matchActions.removeDeadlist(norm);
      log.info({ norm: String(norm).trim(), count: clips.length }, 'clip allowed');
      return reply.send({ ok: true, clips });
    } catch (err) {
      const message = err.message ?? 'allow clip failed';
      const code = /required|not found/i.test(message) ? 400 : 502;
      log.warn({ err: message, norm }, 'clip allow failed');
      return reply.code(code).send({ ok: false, error: message });
    }
  });
}
