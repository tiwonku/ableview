/** REST handlers for manual sheet sync from admin (M7). */

export function registerSheetsRoutes(app, { sheetsActions, log }) {
  app.get('/api/sheets/status', async (_req, reply) => {
    const snapshot = sheetsActions.getSnapshot();
    return reply.send({
      syncedAt: snapshot.syncedAt,
      stale: snapshot.stale,
      rowCount: snapshot.rows?.length ?? 0,
      worksheet: snapshot.worksheet,
    });
  });

  app.post('/api/sheets/sync', async (_req, reply) => {
    try {
      await sheetsActions.sync();
      sheetsActions.onSynced?.();
      const snapshot = sheetsActions.getSnapshot();
      log.info({ rowCount: snapshot.rows.length, syncedAt: snapshot.syncedAt }, 'manual sheet sync');
      return reply.send({
        ok: true,
        syncedAt: snapshot.syncedAt,
        rowCount: snapshot.rows.length,
        stale: snapshot.stale,
      });
    } catch (err) {
      const snapshot = sheetsActions.getSnapshot();
      log.warn({ err: err.message }, 'manual sheet sync failed');
      return reply.code(502).send({
        ok: false,
        error: err.message,
        syncedAt: snapshot.syncedAt,
        rowCount: snapshot.rows?.length ?? 0,
        stale: snapshot.stale,
      });
    }
  });
}
