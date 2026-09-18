// E1.31 (sACN) data packet parse/build. Receive-only; no transmit in production.

const ACN_PACKET_IDENTIFIER = Buffer.from('ASC-E1.17\0\0\0', 'ascii');
const VECTOR_ROOT_E131_DATA = 0x00000004;
const VECTOR_E131_DATA_PACKET = 0x00000002;
const VECTOR_DMP_SET_PROPERTY = 0x02;
const DMP_ADDR_DATA_TYPE = 0xa1;

const OFFSET_CID = 22;
const OFFSET_SOURCE_NAME = 44;
const OFFSET_PRIORITY = 108;
const OFFSET_SYNC = 109;
const OFFSET_SEQUENCE = 111;
const OFFSET_OPTIONS = 112;
const OFFSET_UNIVERSE = 113;
const OFFSET_DMP_VECTOR = 117;
const OFFSET_DMP_ADDR_TYPE = 118;
const OFFSET_FIRST_PROPERTY = 119;
const OFFSET_ADDR_INC = 121;
const OFFSET_PROP_COUNT = 123;
const OFFSET_START_CODE = 125;
const OFFSET_DMX = 126;

const HEADER_BYTES = 126;
const SOURCE_NAME_LEN = 64;
const CID_LEN = 16;

export const E131_PORT = 5568;
export const OPTION_PREVIEW = 0x80;
export const OPTION_STREAM_TERMINATED = 0x40;

export function multicastGroupForUniverse(universe) {
  const u = Number(universe) & 0xffff;
  return `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;
}

function flagsAndLength(fromOffset, packetLength) {
  const length = packetLength - fromOffset;
  return 0x7000 | (length & 0x0fff);
}

function readSourceName(buf) {
  const raw = buf.subarray(OFFSET_SOURCE_NAME, OFFSET_SOURCE_NAME + SOURCE_NAME_LEN);
  const nul = raw.indexOf(0);
  const slice = nul === -1 ? raw : raw.subarray(0, nul);
  return slice.toString('utf8').trim();
}

export function parseE131DataPacket(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < HEADER_BYTES + 1) return null;
  if (buf.readUInt16BE(0) !== 0x0010) return null;
  if (buf.readUInt16BE(2) !== 0x0000) return null;
  if (!buf.subarray(4, 16).equals(ACN_PACKET_IDENTIFIER)) return null;
  if (buf.readUInt32BE(18) !== VECTOR_ROOT_E131_DATA) return null;
  if (buf.readUInt32BE(40) !== VECTOR_E131_DATA_PACKET) return null;
  if (buf.readUInt8(OFFSET_DMP_VECTOR) !== VECTOR_DMP_SET_PROPERTY) return null;
  if (buf.readUInt8(OFFSET_DMP_ADDR_TYPE) !== DMP_ADDR_DATA_TYPE) return null;

  const propCount = buf.readUInt16BE(OFFSET_PROP_COUNT);
  if (propCount < 2) return null;
  const dmxCount = propCount - 1;
  if (buf.length < OFFSET_DMX + dmxCount) return null;

  const options = buf.readUInt8(OFFSET_OPTIONS);
  const startCode = buf.readUInt8(OFFSET_START_CODE);
  const dmx = Buffer.from(buf.subarray(OFFSET_DMX, OFFSET_DMX + dmxCount));

  return {
    cid: buf.subarray(OFFSET_CID, OFFSET_CID + CID_LEN).toString('hex'),
    sourceName: readSourceName(buf),
    priority: buf.readUInt8(OFFSET_PRIORITY),
    syncAddress: buf.readUInt16BE(OFFSET_SYNC),
    sequence: buf.readUInt8(OFFSET_SEQUENCE),
    options,
    preview: (options & OPTION_PREVIEW) !== 0,
    terminated: (options & OPTION_STREAM_TERMINATED) !== 0,
    universe: buf.readUInt16BE(OFFSET_UNIVERSE),
    startCode,
    dmx,
  };
}

export function buildE131DataPacket({
  universe = 1,
  dmx,
  sourceName = 'AbleView',
  priority = 100,
  sequence = 0,
  preview = false,
  terminated = false,
  cid,
  startCode = 0,
} = {}) {
  const payload = Buffer.isBuffer(dmx) ? dmx : Buffer.alloc(512);
  const packet = Buffer.alloc(HEADER_BYTES + payload.length);

  packet.writeUInt16BE(0x0010, 0);
  packet.writeUInt16BE(0x0000, 2);
  ACN_PACKET_IDENTIFIER.copy(packet, 4);
  packet.writeUInt16BE(flagsAndLength(16, packet.length), 16);
  packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18);

  const cidBuf = Buffer.isBuffer(cid) && cid.length === CID_LEN ? cid : Buffer.alloc(CID_LEN);
  cidBuf.copy(packet, OFFSET_CID);

  packet.writeUInt16BE(flagsAndLength(38, packet.length), 38);
  packet.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40);

  const nameBuf = Buffer.alloc(SOURCE_NAME_LEN);
  Buffer.from(String(sourceName ?? ''), 'utf8').copy(nameBuf, 0, 0, SOURCE_NAME_LEN - 1);
  nameBuf.copy(packet, OFFSET_SOURCE_NAME);

  packet.writeUInt8(priority, OFFSET_PRIORITY);
  packet.writeUInt16BE(0, OFFSET_SYNC);
  packet.writeUInt8(sequence & 0xff, OFFSET_SEQUENCE);

  let options = 0;
  if (preview) options |= OPTION_PREVIEW;
  if (terminated) options |= OPTION_STREAM_TERMINATED;
  packet.writeUInt8(options, OFFSET_OPTIONS);
  packet.writeUInt16BE(universe & 0xffff, OFFSET_UNIVERSE);

  packet.writeUInt16BE(flagsAndLength(115, packet.length), 115);
  packet.writeUInt8(VECTOR_DMP_SET_PROPERTY, OFFSET_DMP_VECTOR);
  packet.writeUInt8(DMP_ADDR_DATA_TYPE, OFFSET_DMP_ADDR_TYPE);
  packet.writeUInt16BE(0, OFFSET_FIRST_PROPERTY);
  packet.writeUInt16BE(1, OFFSET_ADDR_INC);
  packet.writeUInt16BE(payload.length + 1, OFFSET_PROP_COUNT);
  packet.writeUInt8(startCode, OFFSET_START_CODE);
  payload.copy(packet, OFFSET_DMX);

  return packet;
}

export function readRgb8(dmx, startChannel) {
  const i = startChannel - 1;
  if (!Buffer.isBuffer(dmx) || !Number.isInteger(startChannel) || startChannel < 1) return null;
  if (i + 2 >= dmx.length) return null;
  return { r: dmx[i], g: dmx[i + 1], b: dmx[i + 2] };
}

export function extractSlotColors(dmx, slots) {
  const colors = { main: null, secondary: null, accent: null };
  if (!slots || typeof slots !== 'object') return colors;
  for (const id of Object.keys(colors)) {
    const start = Number(slots[id]?.startChannel);
    colors[id] = Number.isInteger(start) ? readRgb8(dmx, start) : null;
  }
  return colors;
}
