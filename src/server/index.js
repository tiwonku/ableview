import Fastify from 'fastify';
import { WebSocketServer } from 'ws';
import { EVENTS } from '../core/bus.js';
import { readPublicFile } from './static.js';
import { buildHealthReport } from './health.js';
import { registerConfigRoutes } from './config-api.js';
import { registerSheetsRoutes } from './sheets-api.js';
import { registerSimRoutes } from './sim-api.js';
import { registerSessionLogRoutes } from './session-log-api.js';
import { registerMomentsRoutes, buildSessionLogBroadcast } from './moments-api.js';
import { registerMatchRoutes } from './match-api.js';
import { registerSetlistRoutes } from './setlist-api.js';
import { listIpv4Interfaces } from '../sacn/nics.js';
import { DEFAULT_LIVE_COLOR_COLUMNS } from '../core/live-colors.js';
import { buildSharePayload } from '../../public/shared/share-links.js';
import { collectOperatorViews } from '../../public/shared/admin-dashboard.js';

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
  sessionLog,
  matchActions,
  setlistStore,
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

  function compactLiveColors(status) {
    if (!status) return null;
    return {
      enabled: status.enabled === true,
      live: status.live === true,
      lastSeenAt: status.lastSeenAt ?? null,
      universe: status.universe ?? null,
      staticUniverse: status.staticUniverse ?? null,
      fxLive: status.fxLive === true,
      staticLive: status.staticLive === true,
      sourceName: status.sourceName ?? null,
      sourceAddress: status.sourceAddress ?? null,
      colors: status.colors ?? null,
      staticColors: status.staticColors ?? null,
      moving: status.moving === true,
    };
  }

  function buildStatus() {
    const ingest = getHealthContext?.()?.getIngestStatus?.() ?? null;
    const timecode = getHealthContext?.()?.getTimecodeStatus?.() ?? null;
    const liveColors = getHealthContext?.()?.getLiveColorsStatus?.() ?? null;
    return {
      connectedViews: getConnectedViewCount(),
      ingest: ingest
        ? {
            live: ingest.live,
            lastSeenAt: ingest.lastSeenAt ?? null,
            trackNames: ingest.trackNames ?? null,
            cueTrackConfigured: ingest.cueTrackConfigured ?? null,
            cueTrackFound: ingest.cueTrackFound ?? null,
          }
        : null,
      timecode: timecode
        ? {
            enabled: timecode.enabled === true,
            live: timecode.live === true,
            lastSeenAt: timecode.lastSeenAt ?? null,
            timecode: timecode.timecode ?? null,
          }
        : null,
      liveColors: compactLiveColors(liveColors),
    };
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

  function wantsStatus(viewId) {
    return viewId === 'admin' || viewId === 'setlist';
  }

  function broadcastStatus() {
    const status = buildStatus();
    const data = JSON.stringify({ type: 'status', status });
    for (const [ws, { viewId }] of clients) {
      if (wantsStatus(viewId) && ws.readyState === ws.OPEN) ws.send(data);
    }
  }

  function broadcastSessionLog() {
    if (!sessionLog) return;
    broadcast({
      type: 'sessionLog',
      sessionLog: buildSessionLogBroadcast(sessionLog),
    });
  }

  function broadcastSetlist() {
    if (!setlistStore) return;
    broadcast({
      type: 'setlist',
      setlist: setlistStore.getState(),
    });
  }

  bus.on(EVENTS.CUE_PAYLOAD, (payload) => {
    lastPayload = clientPayload(payload);
    broadcast({ type: 'cue', payload: lastPayload });
    log.debug({ clipName: payload.clipName, clients: clients.size }, 'broadcast cue');
  });

  bus.on(EVENTS.INGEST_STATUS, () => {
    broadcastStatus();
  });

  let timecodeBroadcastTimer = null;
  bus.on(EVENTS.TIMECODE, () => {
    if (timecodeBroadcastTimer) return;
    timecodeBroadcastTimer = setTimeout(() => {
      timecodeBroadcastTimer = null;
      broadcastStatus();
    }, 250);
    timecodeBroadcastTimer.unref?.();
  });

  let liveColorsBroadcastTimer = null;
  let lastLiveColors = getHealthContext?.()?.getLiveColorsStatus?.() ?? null;
  bus.on(EVENTS.LIVE_COLORS, (status) => {
    lastLiveColors = status;
    if (liveColorsBroadcastTimer) return;
    liveColorsBroadcastTimer = setTimeout(() => {
      liveColorsBroadcastTimer = null;
      const payload = compactLiveColors(lastLiveColors);
      const columns = getLiveConfig().sacn?.viewColumns ?? DEFAULT_LIVE_COLOR_COLUMNS;
      broadcast({ type: 'liveColors', liveColors: payload, liveColorColumns: columns });
    }, 16);
    liveColorsBroadcastTimer.unref?.();
  });

  const app = Fastify({ logger: false });

  app.get('/', async (req, reply) => {
    const url = req.raw?.url ?? req.url ?? '';
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
    return reply.redirect(`/views/band${query}`);
  });

  app.get('/health', async (_req, reply) => {
    const ctx = getHealthContext?.() ?? {};
    const report = buildHealthReport({
      simulated: ctx.simulated ?? false,
      getSheetSnapshot: ctx.getSheetSnapshot ?? (() => ({ syncedAt: null, stale: true, rows: [] })),
      getConnectedViewCount,
      getIngestStatus: ctx.getIngestStatus,
      getTimecodeStatus: ctx.getTimecodeStatus,
      getLiveColorsStatus: ctx.getLiveColorsStatus,
      getOscOutStatus: ctx.getOscOutStatus,
      lastCuePayload: lastPayload,
    });
    const code = report.status === 'ok' ? 200 : 503;
    return reply.code(code).send(report);
  });

  if (configRuntime) {
    registerConfigRoutes(app, {
      configRuntime,
      log,
      getOscOutStatus: () => getHealthContext?.()?.getOscOutStatus?.() ?? null,
    });
  }

  function listeningHttpPort() {
    const bound = app.server.address();
    if (typeof bound === 'object' && bound && Number.isInteger(bound.port)) {
      return bound.port;
    }
    return config.server.httpPort;
  }

  app.get('/api/net/interfaces', async (_req, reply) => {
    const interfaces = listIpv4Interfaces();
    const httpPort = listeningHttpPort();
    return reply.send({
      httpPort,
      interfaces,
      share: buildSharePayload({
        httpPort,
        interfaces,
        views: config.views,
      }),
    });
  });

  if (sheetsActions) {
    registerSheetsRoutes(app, { sheetsActions, log });
  }

  if (matchActions) {
    registerMatchRoutes(app, { matchActions, log });
  }

  if (simActions) {
    registerSimRoutes(app, { simActions, log });
  }

  if (sessionLog) {
    registerSessionLogRoutes(app, { sessionLog, log });
    registerMomentsRoutes(app, { sessionLog, log });
    sessionLog.setOnSessionLogChange?.(broadcastSessionLog);
  }

  registerSetlistRoutes(app, { setlistStore, log });
  setlistStore?.setOnChange?.(broadcastSetlist);

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
    if (sessionLog) {
      init.sessionLog = buildSessionLogBroadcast(sessionLog);
    }
    if (setlistStore) {
      init.setlist = setlistStore.getState();
    }
    init.liveColors = compactLiveColors(
      lastLiveColors ?? getHealthContext?.()?.getLiveColorsStatus?.() ?? null,
    );
    init.liveColorColumns = getLiveConfig().sacn?.viewColumns ?? DEFAULT_LIVE_COLOR_COLUMNS;
    if (viewConfig.system) {
      init.system = true;
      init.status = buildStatus();
      init.editorColumns = getLiveConfig().sheets?.editorColumns ?? {};
      const snapshot = sheetsActions?.getSnapshot?.();
      if (snapshot) {
        init.sheetHeaders = snapshot.headers ?? [];
        init.matchColumn = snapshot.matchColumn ?? getLiveConfig().sheets?.matchColumn ?? null;
        init.aliasColumn = snapshot.aliasColumn ?? getLiveConfig().sheets?.aliasColumn ?? null;
      }
      if (viewId === 'admin') {
        init.operatorViews = collectOperatorViews(getLiveConfig().views);
      }
    } else {
      init.editable = viewConfig.editable !== false;
      const snapshot = sheetsActions?.getSnapshot?.();
      init.matchColumn = snapshot?.matchColumn ?? getLiveConfig().sheets?.matchColumn ?? null;
      if (init.editable) {
        init.editorColumns = getLiveConfig().sheets?.editorColumns ?? {};
        init.aliasColumn = snapshot?.aliasColumn ?? getLiveConfig().sheets?.aliasColumn ?? null;
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
    broadcastSessionLog,
    broadcastSetlist,
    async stop() {
      if (timecodeBroadcastTimer) clearTimeout(timecodeBroadcastTimer);
      if (liveColorsBroadcastTimer) clearTimeout(liveColorsBroadcastTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      for (const ws of clients.keys()) ws.close();
      await new Promise((resolve) => wss.close(resolve));
      await app.close();
    },
  };
}
