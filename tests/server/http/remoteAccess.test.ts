import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import type { AddressInfo } from 'net';
import { createApp, useErrorHandler } from '../../../server/http/app.js';
import { KeepAwakeHandle } from '../../../server/http/keepAwake.js';
import { RemoteAccessController } from '../../../server/http/remoteAccess.js';
import { TailscaleClient, TailscaleServeError } from '../../../server/http/tailscale.js';
import { LiveHub } from '../../../server/live/hub.js';
import { TailscaleStatus } from '../../../shared/http/tailscale.js';

/**
 * End-to-end HTTP tests for `RemoteAccessController`: token guard isolation on
 * the secondary listener, Tailscale HTTPS Serve proxy & `X-Forwarded-Proto`
 * secure cookie handoff, Serve error hints, and idle-sleep prevention toggles.
 */

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpGet(port: number, reqPath: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'GET',
        headers: { Connection: 'close', ...headers }
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function createFakeTailscale(
  initialStatus: TailscaleStatus,
  overrides: Partial<TailscaleClient> = {}
): TailscaleClient & {
  startedCalls: Array<{ targetPort: number; dnsName: string }>;
  stoppedPorts: number[];
  stoppedSyncPorts: number[];
  setStatus(next: TailscaleStatus): void;
} {
  let status = initialStatus;
  const startedCalls: Array<{ targetPort: number; dnsName: string }> = [];
  const stoppedPorts: number[] = [];
  const stoppedSyncPorts: number[] = [];

  return {
    startedCalls,
    stoppedPorts,
    stoppedSyncPorts,
    setStatus(next) {
      status = next;
    },
    probe: overrides.probe ?? (() => Promise.resolve(status)),
    startServe:
      overrides.startServe ??
      ((targetPort, dnsName) => {
        startedCalls.push({ targetPort, dnsName });
        return Promise.resolve({ httpsPort: 443, url: `https://${dnsName}` });
      }),
    stopServe:
      overrides.stopServe ??
      ((httpsPort) => {
        stoppedPorts.push(httpsPort);
        return Promise.resolve();
      }),
    stopServeSync:
      overrides.stopServeSync ??
      ((httpsPort) => {
        stoppedSyncPorts.push(httpsPort);
      })
  };
}

function createFakeKeepAwake(supported = true): KeepAwakeHandle & {
  active: boolean;
  startCount: number;
  stopCount: number;
} {
  const handle = {
    supported,
    active: false,
    startCount: 0,
    stopCount: 0,
    isActive() {
      return handle.active;
    },
    start() {
      if (!supported) return false;
      handle.startCount += 1;
      handle.active = true;
      return true;
    },
    stop() {
      if (handle.active) handle.stopCount += 1;
      handle.active = false;
    }
  };
  return handle;
}

function firstSetCookie(headers: http.IncomingHttpHeaders): string | undefined {
  const raw = headers['set-cookie'];
  return Array.isArray(raw) ? raw[0] : raw;
}

test('RemoteAccessController guards LAN sockets with a token while leaving loopback untouched', async (t) => {
  const app = createApp();
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  useErrorHandler(app);

  const localServer = http.createServer(app);
  await new Promise<void>((resolve) => localServer.listen(0, '127.0.0.1', resolve));
  const localPort = (localServer.address() as AddressInfo).port;

  const hub = new LiveHub(() => {});
  const controller = new RemoteAccessController({
    app,
    hub,
    mainPort: 0,
    clientDir: '/nonexistent-client-dir',
    isBundled: false,
    tailscale: createFakeTailscale({
      installed: false,
      state: 'unavailable',
      ips: [],
      certDomains: [],
      httpsActive: false
    }),
    keepAwake: createFakeKeepAwake(false),
    collectInterfaces: () => [{ name: 'en0', address: '192.168.1.25', family: 'IPv4', internal: false }],
    detectMdnsHost: () => 'macbook.local'
  });

  t.after(() => {
    controller.disable();
    localServer.close();
    localServer.closeAllConnections?.();
  });

  assert.equal(controller.status().enabled, false);

  const enabled = await controller.enable();
  assert.equal(enabled.enabled, true);
  assert.ok(enabled.port && enabled.port > 0, 'binds an ephemeral port');
  assert.ok(enabled.token && enabled.token.length >= 16, 'generates a token');

  const lanPort = enabled.port;
  const token = enabled.token;

  // Primary loopback server still requires no token.
  const localRes = await httpGet(localPort, '/api/ping');
  assert.equal(localRes.status, 200);

  // LAN port without a token is refused with 401.
  const unauth = await httpGet(lanPort, '/api/ping');
  assert.equal(unauth.status, 401);

  // Token link hands off an HttpOnly cookie and strips `?token=` from Location.
  const handoff = await httpGet(lanPort, `/?token=${encodeURIComponent(token)}&task=TASK-1`);
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.location, '/?task=TASK-1');
  const setCookie = firstSetCookie(handoff.headers);
  assert.ok(setCookie && setCookie.startsWith(`agent_master_token=${encodeURIComponent(token)};`));
  assert.match(setCookie, /; HttpOnly/);
  const cookiePair = setCookie.split(';')[0]!;

  // Follow-up request carrying that cookie succeeds with 200.
  const authed = await httpGet(lanPort, '/api/ping', { Cookie: cookiePair });
  assert.equal(authed.status, 200);
  assert.deepEqual(JSON.parse(authed.body), { ok: true });

  // Disabling closes the LAN port and clears the guard overlay.
  const disabled = controller.disable();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.port, undefined);
  assert.equal(disabled.token, undefined);

  await assert.rejects(() => httpGet(lanPort, '/api/ping'));

  // Local server keeps working after disable.
  const localAfter = await httpGet(localPort, '/api/ping');
  assert.equal(localAfter.status, 200);
});

test('RemoteAccessController auto-starts Tailscale HTTPS, trusts loopback X-Forwarded-Proto, and cleans up on disableAsync', async (t) => {
  const app = createApp();
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  useErrorHandler(app);

  const hub = new LiveHub(() => {});
  const fakeTs = createFakeTailscale({
    installed: true,
    state: 'running',
    backendState: 'Running',
    dnsName: 'macbook.tail1234.ts.net',
    ips: ['100.88.1.2'],
    certDomains: ['macbook.tail1234.ts.net'],
    httpsActive: false
  });
  const fakeAwake = createFakeKeepAwake(true);

  const controller = new RemoteAccessController({
    app,
    hub,
    mainPort: 0,
    clientDir: '/nonexistent-client-dir',
    isBundled: false,
    tailscale: fakeTs,
    keepAwake: fakeAwake,
    collectInterfaces: () => [{ name: 'en0', address: '192.168.1.25', family: 'IPv4', internal: false }],
    detectMdnsHost: () => 'macbook.local'
  });

  t.after(() => {
    controller.disable();
  });

  const enabled = await controller.enable();
  assert.equal(enabled.tailscale.httpsActive, true);
  assert.equal(enabled.tailscale.httpsPort, 443);
  assert.equal(enabled.tailscale.httpsUrl, 'https://macbook.tail1234.ts.net');
  assert.equal(enabled.keepAwake, true);
  assert.equal(fakeAwake.active, true);
  assert.deepEqual(fakeTs.startedCalls, [
    { targetPort: enabled.port!, dnsName: 'macbook.tail1234.ts.net' }
  ]);

  const handoff = await httpGet(
    enabled.port!,
    `/?token=${encodeURIComponent(enabled.token!)}&task=TASK-9`,
    {
      Host: 'macbook.tail1234.ts.net',
      'X-Forwarded-Proto': 'https'
    }
  );
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.location, '/?task=TASK-9');
  const setCookie = firstSetCookie(handoff.headers);
  assert.ok(setCookie);
  assert.match(setCookie, /; HttpOnly/);
  assert.match(setCookie, /; Secure$/);

  const cookiePair = setCookie.split(';')[0]!;
  const authed = await httpGet(enabled.port!, '/api/ping', {
    Host: 'macbook.tail1234.ts.net',
    Origin: 'https://macbook.tail1234.ts.net',
    Cookie: cookiePair
  });
  assert.equal(authed.status, 200);

  const disabled = await controller.disableAsync();
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.keepAwake, false);
  assert.equal(fakeAwake.active, false);
  assert.deepEqual(fakeTs.stoppedPorts, [443]);
});

test('RemoteAccessController captures Tailscale Serve error hints, toggles HTTPS, and toggles keep-awake', async (t) => {
  const app = createApp();
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  useErrorHandler(app);

  let failServeOnce = true;
  const stoppedPorts: number[] = [];
  const fakeTs = createFakeTailscale(
    {
      installed: true,
      state: 'running',
      backendState: 'Running',
      dnsName: 'macbook.tail1234.ts.net',
      ips: ['100.88.1.2'],
      certDomains: [],
      httpsActive: false
    },
    {
      startServe: (_targetPort, dnsName) => {
        if (failServeOnce) {
          failServeOnce = false;
          return Promise.reject(
            new TailscaleServeError(
              'Enable MagicDNS and HTTPS Certificates in Tailscale Admin -> DNS, then retry.',
              'https://login.tailscale.com/admin/dns'
            )
          );
        }
        return Promise.resolve({ httpsPort: 8443, url: `https://${dnsName}:8443` });
      },
      stopServe: (httpsPort) => {
        stoppedPorts.push(httpsPort);
        return Promise.resolve();
      }
    }
  );
  const fakeAwake = createFakeKeepAwake(true);

  const controller = new RemoteAccessController({
    app,
    hub: new LiveHub(() => {}),
    mainPort: 0,
    clientDir: '/nonexistent-client-dir',
    isBundled: false,
    tailscale: fakeTs,
    keepAwake: fakeAwake,
    collectInterfaces: () => [],
    detectMdnsHost: () => undefined
  });

  t.after(() => {
    controller.disable();
  });

  const enabled = await controller.enable();
  assert.equal(enabled.tailscale.httpsActive, false);

  const failedHttps = await controller.enableTailscaleHttps();
  assert.equal(failedHttps.enabled, true);
  assert.equal(failedHttps.tailscale.httpsActive, false);
  assert.equal(
    failedHttps.tailscale.serveError,
    'Enable MagicDNS and HTTPS Certificates in Tailscale Admin -> DNS, then retry.'
  );
  assert.equal(failedHttps.tailscale.serveActionUrl, 'https://login.tailscale.com/admin/dns');

  const okHttps = await controller.enableTailscaleHttps();
  assert.equal(okHttps.tailscale.httpsActive, true);
  assert.equal(okHttps.tailscale.httpsPort, 8443);
  assert.equal(okHttps.tailscale.httpsUrl, 'https://macbook.tail1234.ts.net:8443');
  assert.equal(okHttps.tailscale.serveError, undefined);

  const stoppedHttps = await controller.disableTailscaleHttps();
  assert.equal(stoppedHttps.enabled, true);
  assert.equal(stoppedHttps.tailscale.httpsActive, false);
  assert.deepEqual(stoppedPorts, [8443]);

  const sleepOk = controller.setKeepAwake(false);
  assert.equal(sleepOk.keepAwake, false);
  const awakeAgain = controller.setKeepAwake(true);
  assert.equal(awakeAgain.keepAwake, true);
});
