import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { EVENTS } from '../core/bus.js';
import { readPublicFile } from './static.js';
import { buildHealthReport } from './health.js';
import { registerConfigRoutes } from './config-api.js';
import { registerSheetsRoutes } from './sheets-api.js';
import { registerSimRoutes } from './sim-api.js';

function parseViewId(request) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  return url.searchParams.get('view') || 'band';
}

export async function createViewServer({
  config,
  bus,
  log,
  getHealthContext,
  configRuntime,
  sheetsActions,
  simActions,
}) {
  let lastPayload = null;
  const clients = new Map();

  function getConnectedViewCount() {
    let count = 0;
    for (const { viewId } of clients.values()) {
      if (viewId !== 'admin') count++;
    }
    return count;
  }

  function buildStatus() {
    return { connectedViews: getConnectedViewCount() };
  }

  function isSimulated() {
    return getHealthContext?.()?.simulated === true;
  }

  function clientPayload(payload = lastPayload) {
    if (!payload) return null;
    return { ...payload, simulated: isSimulated() };
  }

  function getLiveConfig() {
    return configRuntime?.getConfig() ?? config;
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [ws] of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  function broadcastStatus() {
    const status = buildStatus();
    const data = JSON.stringify({ type: 'status', status });
    for (const [ws, { viewId }] of clients) {
      if (viewId === 'admin' && ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  bus.on(EVENTS.CUE_PAYLOAD, (payload) => {
    lastPayload = clientPayload(payload);
    broadcast({ type: 'cue', payload: lastPayload });
    log.debug({ clipName: payload.clipName, clients: clients.size }, 'broadcast cue');
  });

  const app = Fastify({ logger: false });

  app.get('/', async (_req, reply) => reply.redirect('/views/band'));

  app.get('/health', async (_req, reply) => {
    const ctx = getHealthContext?.() ?? {};
    const report = buildHealthReport({
      simulated: ctx.simulated ?? false,
      getSheetSnapshot: ctx.getSheetSnapshot ?? (() => ({ syncedAt: null, stale: true, rows: [] })),
      getConnectedViewCount,
      lastCuePayload: lastPayload,
    });
    const code = report.status === 'ok' ? 200 : 503;
    return reply.code(code).send(report);
  });

  if (configRuntime) {
    registerConfigRoutes(app, { configRuntime, log });
  }

  if (sheetsActions) {
    registerSheetsRoutes(app, { sheetsActions, log });
  }

  if (simActions) {
    registerSimRoutes(app, { simActions, log });
  }

  app.get('/views/:name', async (req, reply) => {
    try {
      const { content, mime } = await readPublicFile(`views/${req.params.name}.html`);
      return reply.type(mime).send(content);
    } catch (err) {
      if (err.code === 'ENOENT') return reply.code(404).send('Not found');
      throw err;
    }
  });

  app.get('/shared/:file', async (req, reply) => {
    try {
      const { content, mime } = await readPublicFile(`shared/${req.params.file}`);
      return reply.type(mime).send(content);
    } catch (err) {
      if (err.code === 'ENOENT') return reply.code(404).send('Not found');
      throw err;
    }
  });

  await app.listen({ port: config.server.httpPort, host: '0.0.0.0' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.server.httpPort;
  log.info({ port }, 'view server listening');

  const wss = new WebSocketServer({ noServer: true });

  app.server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    const viewId = parseViewId(request);
    const viewConfig = config.views[viewId];
    if (!viewConfig) {
      ws.close(1008, 'unknown view');
      return;
    }

    clients.set(ws, { viewId });
    const init = {
      type: 'init',
      viewId,
      title: viewConfig.title ?? viewId,
      fields: viewConfig.fields ?? [],
      payload: clientPayload(),
      simulated: isSimulated(),
      views: Object.entries(config.views).map(([id, v]) => ({
        id,
        title: v.title ?? id,
      })),
    };
    if (viewConfig.system) {
      init.system = true;
      init.status = buildStatus();
      init.editorColumns = getLiveConfig().sheets?.editorColumns ?? {};
      const snapshot = sheetsActions?.getSnapshot?.();
      if (snapshot) {
        init.sheetHeaders = snapshot.headers ?? [];
        init.matchColumn = snapshot.matchColumn ?? getLiveConfig().sheets?.matchColumn ?? null;
      }
    } else {
      init.editable = viewConfig.editable !== false;
      if (init.editable) {
        init.editorColumns = getLiveConfig().sheets?.editorColumns ?? {};
        const snapshot = sheetsActions?.getSnapshot?.();
        init.matchColumn = snapshot?.matchColumn ?? getLiveConfig().sheets?.matchColumn ?? null;
      }
    }
    ws.send(JSON.stringify(init));
    if (viewId !== 'admin') broadcastStatus();

    ws.on('close', () => {
      clients.delete(ws);
      broadcastStatus();
    });
    ws.on('error', () => {
      clients.delete(ws);
      broadcastStatus();
    });
  });

  let heartbeatTimer = null;
  const heartbeatSeconds = config.server.wsHeartbeatSeconds;
  if (heartbeatSeconds > 0) {
    heartbeatTimer = setInterval(() => {
      for (const [ws] of clients) {
        if (ws.readyState === ws.OPEN) ws.ping();
      }
    }, heartbeatSeconds * 1000);
    heartbeatTimer.unref?.();
  }

  function rebroadcastSimState() {
    if (lastPayload) {
      lastPayload = clientPayload();
      broadcast({ type: 'cue', payload: lastPayload });
      return;
    }
    broadcast({ type: 'simState', simulated: isSimulated() });
  }

  return {
    port,
    getClientCount: () => clients.size,
    getConnectedViewCount,
    rebroadcastSimState,
    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const ws of clients.keys()) ws.close();
      await new Promise((resolve) => wss.close(resolve));
      await app.close();
    },
  };
}
