import test from 'node:test';
import assert from 'node:assert';
import {
  buildRemoteAccessTargets,
  defaultRemoteAccessMode,
  lanAllowedHosts,
  LanInterface,
  RemoteAccessStatus,
  remoteSessionUrl,
  selectLanAddresses,
  selectTailscaleFallbackIp
} from '../../../shared/http/remoteAccess.js';

/**
 * Pure LAN and Tailscale interface ranking, request-guard host list construction,
 * target ordering, and session deep-link URL formatting.
 */

test('selectLanAddresses filters out internal, IPv6, loopback, link-local, Apple P2P, and Tailscale CGNAT interfaces', () => {
  const ifaces: LanInterface[] = [
    { name: 'lo0', address: '127.0.0.1', family: 'IPv4', internal: true },
    { name: 'en0', address: 'fe80::1', family: 'IPv6', internal: false },
    { name: 'en0', address: '169.254.10.20', family: 'IPv4', internal: false },
    { name: 'awdl0', address: '192.168.50.1', family: 'IPv4', internal: false },
    { name: 'llw0', address: '192.168.50.2', family: 'IPv4', internal: false },
    { name: 'en2', address: '127.0.0.2', family: 4, internal: false },
    { name: 'utun5', address: '100.100.5.6', family: 'IPv4', internal: false },
    { name: 'en0', address: '192.168.1.42', family: 'IPv4', internal: false }
  ];

  assert.deepEqual(selectLanAddresses(ifaces), ['192.168.1.42']);
  assert.equal(selectTailscaleFallbackIp(ifaces), '100.100.5.6');
});

test('selectLanAddresses ranks physical Wi-Fi/Ethernet RFC1918 ahead of other NICs and virtual bridges', () => {
  const ifaces: LanInterface[] = [
    { name: 'docker0', address: '172.17.0.1', family: 'IPv4', internal: false },
    { name: 'utun4', address: '10.8.0.2', family: 'IPv4', internal: false },
    { name: 'en5', address: '203.0.113.5', family: 'IPv4', internal: false },
    { name: 'en4', address: '172.20.10.3', family: 'IPv4', internal: false },
    { name: 'wlan0', address: '10.0.0.12', family: 4, internal: false },
    { name: 'en0', address: '192.168.1.25', family: 'IPv4', internal: false },
    // Duplicate address on a worse-ranked interface should keep the better rank.
    { name: 'bridge100', address: '192.168.1.25', family: 'IPv4', internal: false }
  ];

  assert.deepEqual(selectLanAddresses(ifaces), [
    '192.168.1.25', // en0 (preferred + RFC1918)
    '10.0.0.12',    // wlan0 (preferred + RFC1918)
    '172.20.10.3',  // en4 (non-virtual + RFC1918)
    '203.0.113.5',  // en5 (non-virtual + public)
    '172.17.0.1',   // docker0 (virtual + RFC1918)
    '10.8.0.2'      // utun4 (virtual + RFC1918)
  ]);
});

test('lanAllowedHosts normalizes addresses, optional mDNS host, and extra hosts without duplicates', () => {
  assert.deepEqual(
    lanAllowedHosts(
      ['192.168.1.25', '192.168.1.25', 'http://10.0.0.5:3002'],
      'MacBook.LOCAL.',
      ['MacBook.Tail1234.ts.net.', '192.168.1.25', '100.88.1.2']
    ),
    ['192.168.1.25', '10.0.0.5', 'macbook.local', 'macbook.tail1234.ts.net', '100.88.1.2']
  );
  assert.deepEqual(lanAllowedHosts(['192.168.1.25']), ['192.168.1.25']);
});

test('remoteSessionUrl builds HTTP and HTTPS deep links and omits default ports', () => {
  assert.equal(
    remoteSessionUrl({
      host: '192.168.1.25',
      port: 3002,
      token: 'tok123',
      taskId: 'TASK-42',
      sessionId: 'ses_abc'
    }),
    'http://192.168.1.25:3002/?token=tok123&task=TASK-42&session=ses_abc'
  );

  assert.equal(
    remoteSessionUrl({
      host: 'macbook.local',
      port: 3738,
      taskId: 'TASK-7'
    }),
    'http://macbook.local:3738/?task=TASK-7'
  );

  assert.equal(
    remoteSessionUrl({ host: '192.168.1.25', port: 3002 }),
    'http://192.168.1.25:3002/'
  );

  assert.equal(
    remoteSessionUrl({
      protocol: 'https',
      host: 'macbook.tail1234.ts.net',
      port: 443,
      token: 'tok',
      taskId: 'TASK-1'
    }),
    'https://macbook.tail1234.ts.net/?token=tok&task=TASK-1'
  );

  assert.equal(
    remoteSessionUrl({
      protocol: 'https',
      host: 'macbook.tail1234.ts.net',
      port: 8443
    }),
    'https://macbook.tail1234.ts.net:8443/'
  );
});

test('buildRemoteAccessTargets orders Tailscale and LAN targets and selects default mode', () => {
  const status: RemoteAccessStatus = {
    enabled: true,
    port: 3002,
    token: 'tok',
    addresses: ['192.168.1.25'],
    mdnsHost: 'macbook.local',
    servesUi: true,
    keepAwake: true,
    keepAwakeSupported: true,
    tailscale: {
      installed: true,
      state: 'running',
      dnsName: 'macbook.tail1234.ts.net',
      ips: ['100.88.1.2', 'fd7a:115c:a1e0::1'],
      certDomains: ['macbook.tail1234.ts.net'],
      httpsActive: true,
      httpsPort: 443,
      httpsUrl: 'https://macbook.tail1234.ts.net'
    }
  };

  assert.equal(defaultRemoteAccessMode(status), 'tailscale');
  assert.deepEqual(
    buildRemoteAccessTargets(status).map((t) => `${t.mode}:${t.id}:${t.protocol}:${t.port}:${t.secure}`),
    [
      'tailscale:ts-https:https:443:true',
      'tailscale:ts-dns:http:3002:false',
      'tailscale:ts-ip:100.88.1.2:http:3002:false',
      'lan:lan:192.168.1.25:http:3002:false',
      'lan:lan:macbook.local:http:3002:false'
    ]
  );

  assert.equal(
    defaultRemoteAccessMode({
      ...status,
      tailscale: { ...status.tailscale, httpsActive: false, httpsPort: undefined, httpsUrl: undefined }
    }),
    'lan'
  );

  assert.equal(
    defaultRemoteAccessMode({
      ...status,
      addresses: [],
      tailscale: { ...status.tailscale, httpsActive: false }
    }),
    'tailscale'
  );

  assert.deepEqual(buildRemoteAccessTargets({ ...status, enabled: false }), []);
});
