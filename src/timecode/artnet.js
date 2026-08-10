import { makeTimecode } from '../core/timecode.js';

const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii');
const OP_TIMECODE = 0x9700;
const TIMECODE_OFFSET = 14;

export function parseArtTimeCodePacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < TIMECODE_OFFSET + 5) return null;
  if (!buf.subarray(0, 8).equals(ARTNET_ID)) return null;

  const opCode = buf.readUInt16LE(8);
  if (opCode !== OP_TIMECODE) return null;

  const frames = buf.readUInt8(TIMECODE_OFFSET);
  const seconds = buf.readUInt8(TIMECODE_OFFSET + 1);
  const minutes = buf.readUInt8(TIMECODE_OFFSET + 2);
  const hours = buf.readUInt8(TIMECODE_OFFSET + 3);
  const type = buf.readUInt8(TIMECODE_OFFSET + 4);

  return makeTimecode({ hours, minutes, seconds, frames, type });
}

export function buildArtTimeCodePacket({
  hours = 0,
  minutes = 0,
  seconds = 0,
  frames = 0,
  type = 1,
  filler1 = 0,
  filler2 = 0,
} = {}) {
  const buf = Buffer.alloc(TIMECODE_OFFSET + 5);
  ARTNET_ID.copy(buf, 0);
  buf.writeUInt16LE(OP_TIMECODE, 8);
  buf.writeUInt16LE(14, 10);
  buf.writeUInt8(filler1, 12);
  buf.writeUInt8(filler2, 13);
  buf.writeUInt8(frames, TIMECODE_OFFSET);
  buf.writeUInt8(seconds, TIMECODE_OFFSET + 1);
  buf.writeUInt8(minutes, TIMECODE_OFFSET + 2);
  buf.writeUInt8(hours, TIMECODE_OFFSET + 3);
  buf.writeUInt8(type, TIMECODE_OFFSET + 4);
  return buf;
}
