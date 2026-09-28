import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';
import { serveClient } from '../../../server/http/clientStatic.js';

function builtClient(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-master-3000-client-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>board</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'notification-sw.js'), 'self.addEventListener("x", () => {})');
  return dir;
}

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const dir = builtClient();
  const app = express();
  app.get('/api/board', (_req, res) => {
    res.json({ tasks: [] });
  });
  assert.strictEqual(serveClient(app, dir), true);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('nothing is mounted when there is no built client', () => {
  const app = express();
  assert.strictEqual(serveClient(app, path.join(os.tmpdir(), 'agent-master-3000-no-such-dir')), false);
});

test('hashed assets are cached forever, everything else is revalidated', async () => {
  await withServer(async (base) => {
    const asset = await fetch(`${base}/assets/index-abc123.js`);
    assert.strictEqual(asset.status, 200);
    assert.strictEqual(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const worker = await fetch(`${base}/notification-sw.js`);
    assert.strictEqual(worker.status, 200);
    assert.strictEqual(worker.headers.get('cache-control'), 'no-cache');

    const root = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    assert.strictEqual(root.status, 200);
    assert.strictEqual(root.headers.get('cache-control'), 'no-cache');
    assert.match(await root.text(), /<title>board<\/title>/);
  });
});

test('a deep link gets the app, but /api, /ws and a missing asset do not', async () => {
  await withServer(async (base) => {
    const deep = await fetch(`${base}/tasks/TASK-1`, { headers: { accept: 'text/html' } });
    assert.strictEqual(deep.status, 200);
    assert.match(await deep.text(), /<title>board<\/title>/);

    const api = await fetch(`${base}/api/board`);
    assert.deepStrictEqual(await api.json(), { tasks: [] });

    const unknownApi = await fetch(`${base}/api/nope`, { headers: { accept: 'text/html' } });
    assert.strictEqual(unknownApi.status, 404);
    assert.deepStrictEqual(await unknownApi.json(), { error: 'Not found' });

    const ws = await fetch(`${base}/ws`, { headers: { accept: 'text/html' } });
    assert.strictEqual(ws.status, 404);

    const missing = await fetch(`${base}/assets/gone-000.js`, { headers: { accept: 'text/html' } });
    assert.strictEqual(missing.status, 404);
  });
});
