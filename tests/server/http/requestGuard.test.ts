import test from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import { createApp, useErrorHandler } from '../../../server/http/app.js';
import { verifySocketClient } from '../../../server/http/requestGuard.js';

/**
 * The guard as the server mounts it: the real middleware stack and the real
 * socket check on an ephemeral loopback port, with a route standing in for
 * the board's. `shared/http/requestGuard.ts` has the rules; this has the wiring.
 */

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const app = createApp();
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  app.post('/api/ping', (_req, res) => res.json({ ok: true }));
  useErrorHandler(app);
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024, verifyClient: verifySocketClient });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    wss.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function request(port: number, method: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/ping', method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

function openSocket(port: number, headers: Record<string, string>): Promise<'open' | number> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    socket.on('open', () => {
      socket.close();
      resolve('open');
    });
    socket.on('unexpected-response', (_req, res) => resolve(res.statusCode || 0));
    socket.on('error', () => resolve(0));
  });
}

test('the board UI and local tools are answered; nothing else is', async () => {
  await withServer(async (port) => {
    const own = await request(port, 'POST', {
      Host: `127.0.0.1:${port}`,
      Origin: 'http://127.0.0.1:3999',
      'Content-Type': 'application/json'
    });
    assert.equal(own.status, 200);
    assert.equal(own.headers['access-control-allow-origin'], 'http://127.0.0.1:3999');
    assert.equal(own.headers['x-content-type-options'], 'nosniff');
    assert.equal(own.headers['x-powered-by'], undefined);

    assert.equal((await request(port, 'GET', { Host: `localhost:${port}` })).status, 200);

    const rebound = await request(port, 'GET', { Host: `attacker.example:${port}` });
    assert.equal(rebound.status, 403);
    assert.match(JSON.parse(rebound.body).error, /BOARD_ALLOWED_HOSTS/);

    const crossSite = await request(port, 'POST', {
      Host: `127.0.0.1:${port}`,
      Origin: 'https://evil.example',
      'Content-Type': 'text/plain'
    });
    assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers['access-control-allow-origin'], undefined);

    const imgTag = await request(port, 'GET', { Host: `127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(imgTag.status, 403);
  });
});

test('the live socket opens for the board and refuses another site', async () => {
  await withServer(async (port) => {
    assert.equal(await openSocket(port, { Origin: 'http://127.0.0.1:3999' }), 'open');
    assert.equal(await openSocket(port, { Origin: 'https://evil.example' }), 403);
    assert.equal(await openSocket(port, { Origin: 'http://127.0.0.1:3999', Host: 'attacker.example' }), 403);
  });
});
