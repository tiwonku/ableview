import { EventEmitter } from 'node:events';

// Internal event bus. The view server (M4) and any future outputs
// (e.g. OSC rebroadcast, §11) subscribe to the same stream.
export const EVENTS = Object.freeze({
  NOW_PLAYING: 'nowPlaying',
  CUE_PAYLOAD: 'cuePayload',
  INGEST_STATUS: 'ingestStatus',
  TIMECODE: 'timecode',
});

export function createBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(50);
  return bus;
}
