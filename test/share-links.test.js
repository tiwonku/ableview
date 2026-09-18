import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSharePayload,
  defaultShareViewId,
  isLinkLocalIpv4,
  isPrivateIpv4,
  isUnspecifiedOrLoopback,
  listedViews,
  originForAddress,
  shareFromNetResponse,
  shareUrl,
  shareableInterfaces,
} from '../public/shared/share-links.js';

test('originForAddress omits port 80 and includes other ports', () => {
  assert.equal(originForAddress('192.168.1.10', 80), 'http://192.168.1.10');
  assert.equal(originForAddress('192.168.1.10', 8080), 'http://192.168.1.10:8080');
});

test('shareableInterfaces skips loopback/unspecified and ranks private first', () => {
  assert.equal(isUnspecifiedOrLoopback('0.0.0.0'), true);
  assert.equal(isUnspecifiedOrLoopback('127.0.0.1'), true);
  assert.equal(isPrivateIpv4('10.0.0.5'), true);
  assert.equal(isPrivateIpv4('172.16.4.1'), true);
  assert.equal(isPrivateIpv4('192.168.0.9'), true);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(isLinkLocalIpv4('169.254.1.1'), true);

  const nics = shareableInterfaces([
    { name: 'All interfaces', address: '0.0.0.0' },
    { name: 'Wi-Fi', address: '169.254.10.2' },
    { name: 'Ethernet', address: '192.168.10.4' },
    { name: 'Loop', address: '127.0.0.1' },
    { name: 'Dup', address: '192.168.10.4' },
  ]);
  assert.deepEqual(nics.map((n) => n.address), ['192.168.10.4', '169.254.10.2']);
});

test('buildSharePayload lists views and does not recommend when two private NICs exist', () => {
  const share = buildSharePayload({
    httpPort: 8080,
    interfaces: [
      { name: 'All interfaces', address: '0.0.0.0' },
      { name: 'Ethernet', address: '10.0.0.8' },
      { name: 'Link', address: '192.168.99.2' },
    ],
    views: {
      band: { title: 'Band' },
      lighting: { title: 'Lighting' },
    },
  });
  assert.equal(share.port, 8080);
  assert.deepEqual(share.views.map((v) => v.id), ['band', 'lighting']);
  assert.equal(share.views[0].path, '/views/band');
  assert.equal(share.origins[0].recommended, false);
  assert.equal(share.origins[1].recommended, false);
  assert.equal(share.origins[0].origin, 'http://10.0.0.8:8080');
  assert.equal(shareUrl(share.origins[0].origin, 'visuals'), 'http://10.0.0.8:8080/views/visuals');
  assert.equal(defaultShareViewId(share.views), 'band');
  assert.equal(listedViews([{ id: 'setlist', title: 'Set' }])[0].path, '/views/setlist');
});

test('shareFromNetResponse uses server share or builds a fallback', () => {
  const fromServer = shareFromNetResponse({
    httpPort: 8080,
    interfaces: [{ name: 'All interfaces', address: '0.0.0.0' }],
    share: { port: 8080, views: [{ id: 'band', title: 'Band', path: '/views/band' }], origins: [] },
  });
  assert.equal(fromServer.port, 8080);
  assert.equal(fromServer.origins.length, 0);

  const fallback = shareFromNetResponse({
    httpPort: 9090,
    interfaces: [
      { name: 'All interfaces', address: '0.0.0.0' },
      { name: 'LAN', address: '192.168.1.20' },
    ],
  }, { fallbackViews: { band: { title: 'Band' } } });
  assert.equal(fallback.port, 9090);
  assert.equal(fallback.origins[0].origin, 'http://192.168.1.20:9090');
  assert.ok(fallback.views.some((v) => v.id === 'band'));
  assert.equal(fallback.origins[0].recommended, true);
});

test('recommended is only set when there is a single private NIC', () => {
  const one = buildSharePayload({
    httpPort: 8080,
    interfaces: [{ name: 'LAN', address: '192.168.1.20' }],
    views: { band: { title: 'Band' } },
  });
  assert.equal(one.origins[0].recommended, true);
});
