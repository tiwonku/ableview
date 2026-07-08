import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { EVENTS } from '../core/bus.js';
import { readPublicFile } from './static.js';

function parseViewId(request) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  return url.searchParams.get('view') || 'band';
}

export async function createViewServer({ config, bus, log }) {
  let lastPayload = null;
  const clients = new Map();

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const [ws] of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  bus.on(EVENTS.CUE_PAYLOAD, (payload) => {
    lastPayload = payload;
    broadcast({ type: 'cue', payload });
    log.debug({ clipName: payload.clipName, clients: clients.size }, 'broadcast cue');
  });

  const app = Fastify({ logger: false });

  app.get('/', async (_req, reply) => reply.redirect('/views/band'));

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
    ws.send(JSON.stringify({
      type: 'init',
      viewId,
      title: viewConfig.title ?? viewId,
      fields: viewConfig.fields ?? [],
      payload: lastPayload,
    }));

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
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

  return {
    port,
    getClientCount: () => clients.size,
    async stop() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const ws of clients.keys()) ws.close();
      await new Promise((resolve) => wss.close(resolve));
      await app.close();
    },
  };
}
