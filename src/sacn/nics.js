import os from 'node:os';

/** IPv4 NICs for the sACN interface dropdown (plus 0.0.0.0 = all). */
export function listIpv4Interfaces() {
  const out = [{ name: 'All interfaces', address: '0.0.0.0' }];
  const nics = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(nics)) {
    for (const addr of addrs ?? []) {
      const family = addr.family;
      const isV4 = family === 'IPv4' || family === 4;
      if (!isV4 || addr.internal) continue;
      out.push({ name, address: addr.address });
    }
  }
  return out;
}
