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
}
