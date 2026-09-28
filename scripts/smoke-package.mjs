/**
 * Smoke test for an installed `agent-master-3000`: the thing a release tarball
 * becomes after `npm install -g`, not the source tree.
 *
 *   node scripts/smoke-package.mjs <path to the installed agent-master-3000 bin>
 *
 * Starts it on a free port with the fake ACP agent and every OpenCode path
 * (HOME, OPENCODE_DB, OPENCODE_CONFIG_DIR, OPENCODE_MODELS, OPENCODE_BIN)
 * pointed into a throwaway directory, then checks what a user would hit: the
 * page, a hashed asset, a deep link, the API, the websocket, one agent turn
 * reaching the board, the default data directory, and the bundled MCP server.
 *
 * Meant for CI and containers. It never reads a real OpenCode install, but it
 * is still a board server: on a workstation, run it in Docker (see AGENTS.md).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = process.argv[2];
if (!bin) {
  console.error('usage: node scripts/smoke-package.mjs <path to agent-master-3000>');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeAgent = path.resolve(here, '..', 'tests', 'fixtures', 'fakeAgent.mjs');
const packageDir = path.resolve(path.dirname(fs.realpathSync(bin)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-master-3000-smoke-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home, { recursive: true });

let failed = false;
function check(ok, what) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) failed = true;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const env = { ...process.env };
// Whatever the caller's shell says about the board or OpenCode does not apply here.
for (const name of ['BOARD_STATE_FILE', 'BOARD_ATTACHMENTS_DIR', 'AGENT_MASTER_DATA_DIR', 'XDG_DATA_HOME', 'PORT', 'HOST']) {
  delete env[name];
}
Object.assign(env, {
  HOME: home,
  OPENCODE_DB: path.join(tmp, 'opencode', 'opencode.db'),
  OPENCODE_CONFIG_DIR: path.join(tmp, 'opencode', 'config'),
  OPENCODE_MODELS: path.join(tmp, 'opencode', 'models.json'),
  OPENCODE_BIN: path.join(tmp, 'no-opencode-here'),
  ACP_COMMAND: `node ${fakeAgent}`,
  ACP_FAKE_SCRIPT: 'permission'
});

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const board = spawn(bin, ['--port', String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
board.stdout.on('data', (chunk) => { output += chunk; });
board.stderr.on('data', (chunk) => { output += chunk; });

async function main() {
  const up = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 20_000);
    board.on('exit', () => { clearTimeout(timer); resolve(false); });
    const poll = setInterval(() => {
      if (output.includes('Listening on')) {
        clearInterval(poll);
        clearTimeout(timer);
        resolve(true);
      }
    }, 100);
  });
  check(up, `agent-master-3000 listening on ${base}`);
  if (!up) return;

  const root = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
  const html = await root.text();
  check(root.status === 200 && html.includes('id="root"'), `GET / -> ${root.status} (${root.headers.get('cache-control')})`);

  const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
  const assetRes = await fetch(`${base}${asset}`);
  check(
    assetRes.status === 200 && /immutable/.test(assetRes.headers.get('cache-control') || ''),
    `GET ${asset} -> ${assetRes.status} (${assetRes.headers.get('cache-control')})`
  );

  const deep = await fetch(`${base}/some/deep/link`, { headers: { accept: 'text/html' } });
  check(deep.status === 200, `GET /some/deep/link (SPA fallback) -> ${deep.status}`);

  const boardRes = await fetch(`${base}/api/board`);
  const boardBody = await boardRes.json();
  check(boardRes.status === 200 && Array.isArray(boardBody.tasks), `GET /api/board -> ${boardRes.status}`);

  const unknown = await fetch(`${base}/api/does-not-exist`, { headers: { accept: 'text/html' } });
  check(unknown.status === 404 && /json/.test(unknown.headers.get('content-type') || ''), `GET /api/does-not-exist -> ${unknown.status} JSON`);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  ws.onmessage = (event) => messages.push(String(event.data));
  const opened = await new Promise((resolve) => {
    ws.onopen = () => resolve(true);
    ws.onerror = () => resolve(false);
  });
  check(opened, 'websocket /ws connected');

  const json = { 'content-type': 'application/json', origin: base };
  const created = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ title: 'smoke task', prompt: 'from the package smoke test' })
  });
  const task = await created.json();
  check(created.status === 201 && Boolean(task.id), `POST /api/tasks -> ${created.status} ${task.id}`);

  const run = await fetch(`${base}/api/tasks/${task.id}/run`, { method: 'POST', headers: json, body: '{}' });
  check(run.status === 200, `POST /api/tasks/${task.id}/run -> ${run.status}`);

  // The fake agent asks to run `rm -rf build` and waits; the board has to show it.
  let asked = false;
  for (let i = 0; i < 60 && !asked; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const snapshot = await (await fetch(`${base}/api/board`)).json();
    asked = JSON.stringify(snapshot.tasks.find((t) => t.id === task.id) || {}).includes('rm -rf build');
  }
  check(asked, 'a fake-agent turn reached the board (permission prompt)');
  check(messages.length > 0, `websocket pushed ${messages.length} update(s)`);
  ws.close();
  await fetch(`${base}/api/tasks/${task.id}/stop`, { method: 'POST', headers: json, body: '{}' });

  const stateFile = path.join(home, '.local', 'share', 'agent-master-3000', 'board_state.json');
  check(fs.existsSync(stateFile), `state in the default data directory (${stateFile})`);

  check(await boardMcpAnswers(), 'bundled board MCP server answers initialize and tools/list');
}

/** The stdio MCP server OpenCode would spawn per session, run the way it would be. */
function boardMcpAnswers() {
  const entry = path.join(packageDir, 'dist-server', 'boardMcp.mjs');
  return new Promise((resolve) => {
    const mcp = spawn(process.execPath, [entry], {
      env: { ...env, AGENT_MASTER_MCP: '1', AGENT_MASTER_URL: base, AGENT_MASTER_TASK_ID: 'TASK-0' },
      stdio: ['pipe', 'pipe', 'inherit']
    });
    let out = '';
    const timer = setTimeout(() => { mcp.kill(); resolve(false); }, 10_000);
    mcp.stdout.on('data', (chunk) => {
      out += chunk;
      const lines = out.split('\n').filter(Boolean);
      if (lines.length >= 2) {
        clearTimeout(timer);
        mcp.kill();
        resolve(lines[0].includes('"serverInfo"') && lines[1].includes('"tools"'));
      }
    });
    mcp.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    mcp.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n');
  });
}

try {
  await main();
} catch (e) {
  check(false, `smoke test threw: ${e instanceof Error ? e.stack : e}`);
} finally {
  // Let it flush its state and stop its agents before the directory goes.
  if (board.exitCode === null) {
    const exited = new Promise((resolve) => board.once('exit', resolve));
    board.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  }
  if (failed) console.log(`\n--- agent-master-3000 output ---\n${output}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
