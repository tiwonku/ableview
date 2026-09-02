/** REST handlers for named setlists (night-specific ordered sheet rows). */

function httpCode(err) {
  const message = err?.message ?? '';
  if (err?.code === 'conflict' || /already exists|already on setlist/i.test(message)) return 409;
  if (/not found/i.test(message)) return 404;
  return 400;
}

export function registerSetlistRoutes(app, { setlistStore, log }) {
  app.get('/api/setlist', async (_req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    return reply.send({ ok: true, ...setlistStore.getState() });
  });

  app.patch('/api/setlist', async (req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    const body = req.body ?? {};
    try {
      let state;
      if (body.duplicate === true) {
        if (body.name == null) throw new Error('body.name is required to duplicate');
        state = setlistStore.duplicate(body.name);
        log.info({ name: state.name }, 'setlist duplicated');
      } else if (body.create === true) {
        if (body.name == null) throw new Error('body.name is required to create');
        state = setlistStore.createNew(body.name);
        log.info({ name: state.name }, 'setlist created');
      } else if (body.delete === true) {
        const previous = setlistStore.getState().name;
        state = setlistStore.removeSetlist();
        log.info({ name: previous, now: state.name }, 'setlist deleted');
      } else if (body.name != null) {
        state = setlistStore.switchTo(body.name);
        log.info({ name: state.name }, 'setlist switched');
      } else if (Array.isArray(body.order)) {
        state = setlistStore.reorder(body.order);
      } else {
        throw new Error('body.name, body.create, body.duplicate, body.delete, or body.order is required');
      }
      return reply.send({ ok: true, ...state });
    } catch (err) {
      const message = err.message ?? 'setlist update failed';
      log.warn({ err: message }, 'setlist patch failed');
      return reply.code(httpCode(err)).send({ ok: false, error: message });
    }
  });

  app.delete('/api/setlist', async (_req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    try {
      const previous = setlistStore.getState().name;
      const state = setlistStore.removeSetlist();
      log.info({ name: previous, now: state.name }, 'setlist deleted');
      return reply.send({ ok: true, ...state });
    } catch (err) {
      const message = err.message ?? 'setlist delete failed';
      log.warn({ err: message }, 'setlist delete failed');
      return reply.code(httpCode(err)).send({ ok: false, error: message });
    }
  });

  app.post('/api/setlist/items', async (req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    const rowId = req.body?.rowId;
    const status = req.body?.status;
    try {
      const state = setlistStore.addItem(rowId, status);
      return reply.send({ ok: true, ...state });
    } catch (err) {
      const message = err.message ?? 'add item failed';
      log.warn({ err: message, rowId }, 'setlist add failed');
      return reply.code(httpCode(err)).send({ ok: false, error: message });
    }
  });

  app.patch('/api/setlist/items/:rowId', async (req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    const { rowId } = req.params;
    const status = req.body?.status;
    try {
      const state = setlistStore.setItemStatus(rowId, status);
      return reply.send({ ok: true, ...state });
    } catch (err) {
      const message = err.message ?? 'update item failed';
      log.warn({ err: message, rowId }, 'setlist item patch failed');
      return reply.code(httpCode(err)).send({ ok: false, error: message });
    }
  });

  app.delete('/api/setlist/items/:rowId', async (req, reply) => {
    if (!setlistStore) {
      return reply.code(501).send({ ok: false, error: 'setlist is not available' });
    }
    const { rowId } = req.params;
    try {
      const state = setlistStore.removeItem(rowId);
      return reply.send({ ok: true, ...state });
    } catch (err) {
      const message = err.message ?? 'remove item failed';
      log.warn({ err: message, rowId }, 'setlist remove failed');
      return reply.code(httpCode(err)).send({ ok: false, error: message });
    }
  });
}
