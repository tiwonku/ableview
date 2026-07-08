/** REST handlers for admin-editable settings (M7). */

export function registerConfigRoutes(app, { configRuntime, log }) {
  app.get('/api/config/settings', async (_req, reply) => {
    return reply.send({ settings: configRuntime.getSettings() });
  });

  app.patch('/api/config/settings', async (req, reply) => {
    const patch = req.body;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      return reply.code(400).send({ error: 'Request body must be a JSON object' });
    }

    try {
      const result = await configRuntime.updateSettings(patch);
      return reply.send(result);
    } catch (err) {
      log.warn({ err: err.message }, 'config update rejected');
      return reply.code(400).send({ error: err.message });
    }
  });
}
