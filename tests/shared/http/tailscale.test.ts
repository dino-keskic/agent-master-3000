import test from 'node:test';
import assert from 'node:assert';
import {
  isTailscaleIpv4,
  normalizeTailscaleDnsName,
  parseServeErrorHint,
  parseServeOccupiedPorts,
  parseTailscaleStatusJson,
  pickServeHttpsPort,
  SERVE_CANDIDATE_PORTS,
  tailscaleAllowedHosts,
  tailscaleServeUrl
} from '../../../shared/http/tailscale.js';

/** Unit tests for pure Tailscale JSON parsing, Serve port picking, URLs, and error hints. */

test('isTailscaleIpv4 enforces RFC 6598 CGNAT bounds 100.64.0.0/10', () => {
  assert.equal(isTailscaleIpv4('100.64.0.0'), true);
  assert.equal(isTailscaleIpv4('100.100.42.9'), true);
  assert.equal(isTailscaleIpv4('100.127.255.255'), true);

  assert.equal(isTailscaleIpv4('100.63.255.255'), false);
  assert.equal(isTailscaleIpv4('100.128.0.0'), false);
  assert.equal(isTailscaleIpv4('192.168.1.1'), false);
  assert.equal(isTailscaleIpv4('100.64.0.999'), false);
  assert.equal(isTailscaleIpv4('not-an-ip'), false);
});

test('normalizeTailscaleDnsName trims trailing dots, lowercases, and rejects invalid chars', () => {
  assert.equal(normalizeTailscaleDnsName('  MacBook.Tail1234.TS.NET. '), 'macbook.tail1234.ts.net');
  assert.equal(normalizeTailscaleDnsName('...'), undefined);
  assert.equal(normalizeTailscaleDnsName('bad/path.ts.net'), undefined);
  assert.equal(normalizeTailscaleDnsName('bad host.ts.net'), undefined);
  assert.equal(normalizeTailscaleDnsName(undefined), undefined);
});

test('parseTailscaleStatusJson parses running state, sorted IPs, cert domains, and tailnet name', () => {
  const running = parseTailscaleStatusJson(
    JSON.stringify({
      BackendState: 'Running',
      Self: {
        DNSName: 'My-Mac.Tail1234.ts.net.',
        TailscaleIPs: ['fd7a:115c:a1e0::1', '100.88.1.2', '100.88.1.2']
      },
      CertDomains: ['My-Mac.Tail1234.ts.net.'],
      CurrentTailnet: {
        MagicDNSSuffix: 'Tail1234.ts.net.',
        Name: 'personal@example.com'
      }
    })
  );

  assert.equal(running.installed, true);
  assert.equal(running.state, 'running');
  assert.equal(running.backendState, 'Running');
  assert.equal(running.dnsName, 'my-mac.tail1234.ts.net');
  assert.equal(running.tailnetName, 'tail1234.ts.net');
  assert.deepEqual(running.ips, ['100.88.1.2', 'fd7a:115c:a1e0::1']);
  assert.deepEqual(running.certDomains, ['my-mac.tail1234.ts.net']);
  assert.equal(running.httpsActive, false);

  const stopped = parseTailscaleStatusJson(JSON.stringify({ BackendState: 'NeedsLogin' }));
  assert.equal(stopped.installed, true);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.backendState, 'NeedsLogin');

  const invalid = parseTailscaleStatusJson('not json');
  assert.equal(invalid.installed, true);
  assert.equal(invalid.state, 'unavailable');
  assert.deepEqual(invalid.ips, []);
});

test('parseServeOccupiedPorts and pickServeHttpsPort avoid occupied TCP and Web ports', () => {
  assert.deepEqual(parseServeOccupiedPorts(''), []);
  assert.deepEqual(parseServeOccupiedPorts('not json'), []);

  const occupied = parseServeOccupiedPorts(
    JSON.stringify({
      TCP: { '443': {}, '9000': {} },
      Web: { 'my-mac.tail1234.ts.net:8443': {} }
    })
  );
  assert.deepEqual(occupied, [443, 8443, 9000]);
  assert.equal(pickServeHttpsPort([]), 443);
  assert.equal(pickServeHttpsPort([443]), 8443);
  assert.equal(pickServeHttpsPort(occupied), 9443);
  assert.equal(pickServeHttpsPort([...SERVE_CANDIDATE_PORTS]), undefined);
});

test('tailscaleServeUrl and tailscaleAllowedHosts format URLs and deduplicate hostnames', () => {
  assert.equal(tailscaleServeUrl('MacBook.Tail1234.ts.net.', 443), 'https://macbook.tail1234.ts.net');
  assert.equal(
    tailscaleServeUrl('MacBook.Tail1234.ts.net.', 8443),
    'https://macbook.tail1234.ts.net:8443'
  );

  const hosts = tailscaleAllowedHosts({
    installed: true,
    state: 'running',
    dnsName: 'macbook.tail1234.ts.net',
    ips: ['100.88.1.2', 'FD7A:115C:A1E0::1'],
    certDomains: ['MacBook.Tail1234.ts.net'],
    httpsActive: false
  });
  assert.deepEqual(hosts, ['macbook.tail1234.ts.net', '100.88.1.2', 'fd7a:115c:a1e0::1']);
});

test('parseServeErrorHint extracts actionable Tailscale Admin hints and URLs', () => {
  const serveDisabled = parseServeErrorHint(
    'Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=abc)'
  );
  assert.equal(serveDisabled.message, 'Enable Tailscale Serve for your tailnet, then retry HTTPS.');
  assert.equal(serveDisabled.actionUrl, 'https://login.tailscale.com/f/serve?node=abc');

  const certsDisabled = parseServeErrorHint('Error: HTTPS certificates must be enabled in DNS');
  assert.equal(
    certsDisabled.message,
    'Enable MagicDNS and HTTPS Certificates in Tailscale Admin -> DNS, then retry.'
  );
  assert.equal(certsDisabled.actionUrl, 'https://login.tailscale.com/admin/dns');

  const generic = parseServeErrorHint('unexpected daemon timeout\nsecond line');
  assert.equal(generic.message, 'unexpected daemon timeout');
  assert.equal(generic.actionUrl, undefined);
});
