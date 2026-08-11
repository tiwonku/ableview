/** REST handlers for session cue log (M10). */

export function registerSessionLogRoutes(app, { sessionLog, log }) {
  app.get('/api/session-log', async (_req, reply) => {
    return reply.send(sessionLog.getStatus());
  });

  app.patch('/api/session-log', async (req, reply) => {
    const body = req.body ?? {};
    try {
      const status = sessionLog.applyPatch({
        enabled: body.enabled,
        sessionName: body.sessionName,
      });
      log.info(
        { enabled: status.enabled, sessionName: status.sessionName },
        'session log updated',
      );
      return reply.send(status);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });
}
