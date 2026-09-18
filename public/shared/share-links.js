// LAN share URLs for operator views (phones / laptops on the same network).

export function isUnspecifiedOrLoopback(address) {
  const ip = String(address ?? '').trim();
  return ip === '' || ip === '0.0.0.0' || ip === '127.0.0.1' || ip === '::' || ip === '::1';
}

export function isPrivateIpv4(address) {
  const parts = String(address ?? '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isLinkLocalIpv4(address) {
  const parts = String(address ?? '').split('.').map(Number);
  return parts.length === 4 && parts[0] === 169 && parts[1] === 254;
}

export function originForAddress(address, port) {
  const host = String(address).includes(':') ? `[${address}]` : address;
  const n = Number(port);
  if (n === 80) return `http://${host}`;
  return `http://${host}:${n}`;
}

export function viewSharePath(viewId) {
  return `/views/${encodeURIComponent(viewId)}`;
}

export function shareUrl(origin, viewId) {
  return `${origin}${viewSharePath(viewId)}`;
}

function originRank(address) {
  if (isPrivateIpv4(address)) return 0;
  if (isLinkLocalIpv4(address)) return 2;
  return 1;
}

export function shareableInterfaces(interfaces) {
  const seen = new Set();
  const out = [];
  for (const nic of interfaces ?? []) {
    const address = String(nic?.address ?? '').trim();
    if (isUnspecifiedOrLoopback(address) || seen.has(address)) continue;
    seen.add(address);
    out.push({
      name: nic.name || address,
      address,
    });
  }
  out.sort((a, b) => originRank(a.address) - originRank(b.address) || a.address.localeCompare(b.address));
  return out;
}

export function listedViews(views) {
  if (Array.isArray(views)) {
    return views
      .map((v) => {
        const id = v?.id ?? v;
        if (!id) return null;
        return { id: String(id), title: v?.title ?? String(id), path: viewSharePath(id) };
      })
      .filter(Boolean);
  }
  return Object.entries(views ?? {}).map(([id, v]) => ({
    id,
    title: v?.title ?? id,
    path: viewSharePath(id),
  }));
}

export function defaultShareViewId(views) {
  const list = listedViews(views);
  if (list.some((v) => v.id === 'band')) return 'band';
  return list[0]?.id ?? 'band';
}

/** Payload for GET /api/net/interfaces `share` (and client fallback). */
export function buildSharePayload({ httpPort, interfaces, views } = {}) {
  const origins = shareableInterfaces(interfaces).map((nic) => ({
    name: nic.name,
    address: nic.address,
    origin: originForAddress(nic.address, httpPort),
    recommended: false,
  }));
  const privateCount = origins.filter((o) => isPrivateIpv4(o.address)).length;
  if (privateCount === 1) {
    const only = origins.find((o) => isPrivateIpv4(o.address));
    if (only) only.recommended = true;
  }
  return {
    port: Number(httpPort),
    views: listedViews(views),
    origins,
  };
}

/** Prefer the server `share` object; otherwise assemble from interfaces + port. */
export function shareFromNetResponse(data, { fallbackPort = 8080, fallbackViews = {} } = {}) {
  if (data?.share && Array.isArray(data.share.origins)) {
    const views = data.share.views?.length ? data.share.views : fallbackViews;
    return {
      port: data.share.port ?? data.httpPort ?? fallbackPort,
      views: listedViews(views),
      origins: data.share.origins,
    };
  }
  return buildSharePayload({
    httpPort: data?.httpPort ?? fallbackPort,
    interfaces: data?.interfaces ?? [],
    views: fallbackViews,
  });
}
