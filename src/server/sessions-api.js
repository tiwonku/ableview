// Logged sets: list session JSONL files and download a Resolve marker EDL.

import { EDL_RATES, buildSessionEdl } from '../../public/shared/edl-markers.js';
import { createSessionArchive } from '../session-log/archive.js';

function flag(value, fallback) {
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return null;
}

function edlSettings(query, summary) {
  const rateGiven = query.rate != null && String(query.rate).trim() !== '';
  const rateId = rateGiven ? String(query.rate).trim() : (summary.dropFrame ? '29.97' : '30');
  const rate = EDL_RATES.find((item) => item.id === rateId);
  if (!rate) {
    return { error: 'Unknown frame rate.' };
  }
  const dropGiven = query.dropFrame != null && String(query.dropFrame).trim() !== '';
  const dropFlag = flag(query.dropFrame, null);
  if (dropGiven && dropFlag == null) {
    return { error: 'Drop frame must be on or off.' };
  }
  // Colon stamps such as 19:49:57:00 are not legal drop-frame numbers.
  // Drop frame stays off unless this log was already stamped with ';'.
  const dropFrame = summary.dropFrame === true && rate.dropAllowed && (dropGiven ? dropFlag === true : true);
  const songs = flag(query.songs, true);
  const dopes = flag(query.dopes, true);
  const notes = flag(query.notes, false);
  const durations = flag(query.durations, false);
  if (songs == null || dopes == null || notes == null || durations == null) {
    return { error: 'Include flags must be on or off.' };
  }
  return {
    rateId,
    dropFrame,
    includeSongs: songs,
    includeDopes: dopes,
    includeNotes: notes,
    durations,
    noteTaker: String(query.noteTaker ?? '').trim().slice(0, 64),
  };
}

export function registerSessionArchiveRoutes(app, { sessionLog, log }) {
  const archive = createSessionArchive({
    getDirectory: () => sessionLog.getStatus().config?.directory,
    loggingName: () => {
      const status = sessionLog.getStatus();
      return status.enabled ? status.sessionName : null;
    },
  });

  app.get('/api/sessions', async (_req, reply) => {
    try {
      const sessions = await archive.list();
      return reply.send({ sessions });
    } catch (err) {
      log.error({ err: err.message }, 'session archive list failed');
      return reply.code(500).send({ error: 'Could not read logged sets.' });
    }
  });

  app.get('/api/sessions/:name', async (req, reply) => {
    try {
      const summary = await archive.read(req.params.name);
      if (!summary) return reply.code(404).send({ error: 'Set not found.' });
      return reply.send(summary);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  app.get('/api/sessions/:name/edl', async (req, reply) => {
    let summary;
    try {
      summary = await archive.read(req.params.name);
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
    if (!summary) return reply.code(404).send({ error: 'Set not found.' });
    const settings = edlSettings(req.query ?? {}, summary);
    if (settings.error) return reply.code(400).send({ error: settings.error });
    const built = buildSessionEdl({
      songs: summary.songs,
      moments: summary.moments,
      includeSongs: settings.includeSongs,
      includeDopes: settings.includeDopes,
      includeNotes: settings.includeNotes,
      noteTaker: settings.noteTaker,
      settings,
      sessionName: summary.name,
    });
    if (!built.ok) return reply.code(400).send({ error: built.error });
    return reply
      .header('Content-Disposition', `attachment; filename="${summary.name}-markers.edl"`)
      .type('text/plain; charset=utf-8')
      .send(built.text);
  });
}
