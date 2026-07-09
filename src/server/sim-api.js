/** REST handlers for manual simulation controls (internal sim mode). */

function notSimulating(reply) {
  return reply.code(400).send({ ok: false, error: 'Simulation mode is not active' });
}

function controlsUnavailable(reply) {
  return reply.code(400).send({
    ok: false,
    error: 'Manual sim controls require sim.mode "internal"',
  });
}

function guardSimControl(simActions, reply) {
  if (!simActions.isAvailable()) return notSimulating(reply);
  if (!simActions.canControl()) return controlsUnavailable(reply);
  return null;
}

export function registerSimRoutes(app, { simActions, log }) {
  app.get('/api/sim/status', async (_req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;
    return reply.send(simActions.getStatus());
  });

  app.post('/api/sim/fire', async (req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;

    const body = req.body ?? {};
    const clipName = typeof body.clipName === 'string' ? body.clipName.trim() : '';
    if (!clipName) {
      return reply.code(400).send({ ok: false, error: 'clipName is required' });
    }

    const tempo = body.tempo == null || body.tempo === '' ? null : Number(body.tempo);
    const beat = body.beat == null || body.beat === '' ? null : Number(body.beat);
    if (tempo != null && Number.isNaN(tempo)) {
      return reply.code(400).send({ ok: false, error: 'tempo must be a number' });
    }
    if (beat != null && Number.isNaN(beat)) {
      return reply.code(400).send({ ok: false, error: 'beat must be a number' });
    }

    const event = simActions.fire(clipName, { tempo, beat });
    log.info({ clipName }, 'manual sim fire');
    return reply.send({
      ok: true,
      authoritativeClip: event.authoritativeClip,
      status: simActions.getStatus(),
    });
  });

  app.post('/api/sim/clear', async (_req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;

    simActions.clear();
    log.info('manual sim clear');
    return reply.send({
      ok: true,
      authoritativeClip: null,
      status: simActions.getStatus(),
    });
  });

  app.post('/api/sim/pause', async (_req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;

    const status = simActions.pause();
    log.info('sim auto-advance paused');
    return reply.send({ ok: true, status });
  });

  app.post('/api/sim/resume', async (_req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;

    try {
      const status = simActions.resume();
      log.info('sim auto-advance resumed');
      return reply.send({ ok: true, status });
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });

  app.post('/api/sim/step', async (req, reply) => {
    const blocked = guardSimControl(simActions, reply);
    if (blocked) return blocked;

    const direction = req.body?.direction;
    if (direction !== 'next' && direction !== 'prev') {
      return reply.code(400).send({ ok: false, error: 'direction must be "next" or "prev"' });
    }

    try {
      const event = simActions.step(direction);
      log.info({ direction, clipName: event.authoritativeClip }, 'manual sim step');
      return reply.send({
        ok: true,
        direction,
        authoritativeClip: event.authoritativeClip,
        status: simActions.getStatus(),
      });
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });
}
