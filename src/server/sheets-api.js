/** REST handlers for manual sheet sync and row edits from admin. */

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

  app.post('/api/sheets/rows', async (req, reply) => {
    const changes = req.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return reply.code(400).send({ ok: false, error: 'request body must be a JSON object of column values' });
    }

    try {
      const { rowId, row } = await sheetsActions.appendRow(changes);
      sheetsActions.onSynced?.();
      const snapshot = sheetsActions.getSnapshot();
      log.info({ rowId, columns: Object.keys(changes) }, 'sheet row appended from admin');
      return reply.send({
        ok: true,
        rowId: String(rowId),
        row,
        syncedAt: snapshot.syncedAt,
        stale: snapshot.stale,
      });
    } catch (err) {
      const snapshot = sheetsActions.getSnapshot();
      const message = err.message ?? 'append failed';
      const code = /unknown column|invalid rowId|row not found|no changes|must be|is required|headers not loaded|already exists|could not parse/i.test(message) ? 400 : 502;
      log.warn({ err: message }, 'sheet row append failed');
      return reply.code(code).send({
        ok: false,
        error: message,
        syncedAt: snapshot.syncedAt,
        stale: snapshot.stale,
      });
    }
  });

  app.patch('/api/sheets/rows/:rowId', async (req, reply) => {
    const { rowId } = req.params;
    const changes = req.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      return reply.code(400).send({ ok: false, error: 'request body must be a JSON object of column changes' });
    }

    try {
      await sheetsActions.updateRow(rowId, changes);
      sheetsActions.onSynced?.();
      const snapshot = sheetsActions.getSnapshot();
      const row = snapshot.rows?.find((r) => r.rowId === String(rowId));
      log.info({ rowId, columns: Object.keys(changes) }, 'sheet row saved from admin');
      return reply.send({
        ok: true,
        rowId: String(rowId),
        row: row?.data ?? null,
        syncedAt: snapshot.syncedAt,
        stale: snapshot.stale,
      });
    } catch (err) {
      const snapshot = sheetsActions.getSnapshot();
      const message = err.message ?? 'update failed';
      const code = /unknown column|invalid rowId|row not found|no changes|must be/i.test(message) ? 400 : 502;
      log.warn({ err: message, rowId }, 'sheet row update failed');
      return reply.code(code).send({
        ok: false,
        error: message,
        syncedAt: snapshot.syncedAt,
        stale: snapshot.stale,
      });
    }
  });
}
