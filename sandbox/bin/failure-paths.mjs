#!/usr/bin/env node
/**
 * The board server's failure paths, each against its own server, inside the
 * sandbox only (it kills processes by name):
 *
 *   docker run --rm agent-master-3000-sandbox node sandbox/bin/failure-paths.mjs
 *
 * Every scenario starts a server on a fresh state file, does one bad thing to
 * it, and checks the server is still answering and the board is still right.
 * Prints one PASS/FAIL line per check and exits non-zero on any failure.
 */
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Buffer } from 'buffer';
import { setTimeout as sleep } from 'timers/promises';
import WebSocket from 'ws';

const { fetch } = globalThis;
const ROOT = '/sandbox/failure-paths';
const FAKE = 'node tests/fixtures/fakeAgent.mjs';
let failures = 0;
let port = 4210;

function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const agentPids = () => execSync("pgrep -f '[f]akeAgent.mjs' || true").toString().trim();

/** A server on its own port and state file; `env` overrides the defaults. */
async function start(name, env = {}, prepare = () => {}) {
  const dir = path.join(ROOT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const state = path.join(dir, 'board_state.json');
  prepare({ dir, state });
  const logFile = path.join(dir, 'server.log');
  const out = fs.openSync(logFile, 'w');
  const p = port++;
  const child = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: '/app',
    stdio: ['ignore', out, out],
    env: {
      ...process.env, PORT: String(p), BOARD_STATE_FILE: state,
      OPENCODE_DB: path.join(dir, 'opencode.db'), ACP_COMMAND: FAKE, ACP_FAKE_SCRIPT: 'stream', ...env
    }
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const base = `http://127.0.0.1:${p}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/projects`)).ok) break;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  const api = async (route, init) => {
    const res = await fetch(`${base}${route}`, {
      ...init, headers: { 'content-type': 'application/json' }, body: init?.body ? JSON.stringify(init.body) : undefined
    });
    const text = await res.text();
    try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text }; }
  };
  const alive = async () => {
    try { return (await api('/api/projects')).status === 200; } catch { return false; }
  };
  const stop = async () => {
    child.kill('SIGTERM');
    return exited;
  };
  const log = () => fs.readFileSync(logFile, 'utf-8');
  return { dir, state, base, api, alive, stop, child, exited, log };
}

async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
}

async function newTask(s, title) {
  return (await s.api('/api/tasks', { method: 'POST', body: { title, prompt: 'go', cwd: '/sandbox/workspace' } })).body;
}
const runState = async (s, id) => (await s.api(`/api/tasks/${id}`)).body.runState;

// --- scenarios ---

async function noAgent() {
  const s = await start('no-agent', { ACP_COMMAND: '/nonexistent/agent-bin' });
  const task = await newTask(s, 'no agent');
  await s.api(`/api/tasks/${task.id}/run`, { method: 'POST', body: { prompt: 'hello' } });
  const settled = await waitFor(async () => (await runState(s, task.id)) !== 'running', 15000);
  check('missing agent binary: the turn ends instead of hanging', settled, await runState(s, task.id));
  check('missing agent binary: the server keeps answering', await s.alive());
  await s.stop();
}

async function corruptState() {
  const garbage = '{"tasks": [ {"id": "TASK-1", "title": "half a fi';
  const s = await start('corrupt-state', {}, ({ state }) => fs.writeFileSync(state, garbage));
  check('corrupt state file: the server starts', await s.alive());
  check('corrupt state file: the original is left as it was', fs.readFileSync(s.state, 'utf-8') === garbage);
  check('corrupt state file: a copy is kept aside', fs.readdirSync(s.dir).some((f) => f.includes('.error-')));
  await s.stop();
}

async function agentDiesMidTurn() {
  const s = await start('agent-dies', { ACP_FAKE_CHUNK_MS: '50' });
  const task = await newTask(s, 'dies');
  await s.api(`/api/tasks/${task.id}/run`, { method: 'POST', body: { prompt: 'hello' } });
  await waitFor(async () => (await runState(s, task.id)) === 'running', 5000);
  await sleep(1500);
  execSync("pkill -KILL -f '[f]akeAgent.mjs' || true");
  const settled = await waitFor(async () => (await runState(s, task.id)) !== 'running', 15000);
  check('agent killed mid-turn: the task leaves "running"', settled, await runState(s, task.id));
  check('agent killed mid-turn: the server keeps answering', await s.alive());

  await s.api(`/api/tasks/${task.id}/run`, { method: 'POST', body: { prompt: 'again' } });
  const started = await waitFor(async () => (await runState(s, task.id)) === 'running', 10000);
  const finished = started && await waitFor(async () => (await runState(s, task.id)) === 'idle', 30000);
  check('agent killed mid-turn: the next turn starts a new agent and finishes', finished, await runState(s, task.id));
  await s.stop();
}

async function socketsMisbehave() {
  const s = await start('ws-drop', { ACP_FAKE_CHUNK_MS: '30' });
  const wsUrl = `${s.base.replace('http', 'ws')}/ws`;
  const open = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
  const sockets = await Promise.all([open(), open(), open()]);
  for (const ws of sockets) ws.on('error', () => {});
  const tasks = await Promise.all([1, 2, 3, 4, 5].map((n) => newTask(s, `ws ${n}`)));
  await Promise.all(tasks.map((t) => s.api(`/api/tasks/${t.id}/run`, { method: 'POST', body: { prompt: 'hello' } })));
  await sleep(1000);

  sockets[0]._socket.destroy();
  // Opcode 0xF is reserved: the server's parser rejects the frame and errors the socket.
  sockets[1]._socket.write(Buffer.from([0x8f, 0x80, 0, 0, 0, 0]));
  sockets[2].terminate();
  await sleep(500);
  check('websocket dropped or sent garbage mid-stream: the server keeps answering', await s.alive());

  const done = await waitFor(async () => {
    const states = await Promise.all(tasks.map((t) => runState(s, t.id)));
    return states.every((state) => state === 'idle');
  }, 30000);
  check('websocket dropped mid-stream: every turn still finishes', done);

  const fresh = await open();
  const got = new Promise((resolve) => fresh.once('message', () => resolve(true)));
  await s.api(`/api/tasks/${tasks[0].id}`, { method: 'PATCH', body: { title: 'renamed' } });
  check('websocket dropped mid-stream: a new client still gets pushes', await Promise.race([got, sleep(3000).then(() => false)]));
  fresh.terminate();
  check('websocket errors were logged, not thrown', !/Uncaught exception/.test(s.log()));
  await s.stop();
}

async function sigtermFlushes() {
  const s = await start('sigterm', { ACP_FAKE_CHUNK_MS: '50' });
  const task = await newTask(s, 'flush me');
  await s.api(`/api/tasks/${task.id}/run`, { method: 'POST', body: { prompt: 'hello' } });
  await waitFor(async () => (await runState(s, task.id)) === 'running', 5000);
  await sleep(1200);
  const rename = await s.api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { title: 'renamed just before the signal' } });
  const sent = Date.now();
  s.child.kill('SIGTERM');
  const { code } = await s.exited;
  const took = Date.now() - sent;
  check('SIGTERM: the server exits promptly', took < 3000, `${took} ms, code ${code}`);
  check('SIGTERM: exit code is 143', code === 143, String(code));
  await sleep(300);
  check('SIGTERM: the agent process is gone too', agentPids() === '', agentPids());

  const board = JSON.parse(fs.readFileSync(s.state, 'utf-8'));
  const saved = board.tasks.find((t) => t.id === task.id);
  check('SIGTERM: the last change is on disk', rename.status === 200 && saved?.title === 'renamed just before the signal');
  const transcript = path.join(`${s.state}.logs`, `${encodeURIComponent(task.id)}.json`);
  const lines = fs.existsSync(transcript) ? JSON.parse(fs.readFileSync(transcript, 'utf-8')) : [];
  check('SIGTERM: the streamed transcript is on disk', lines.some((l) => l.type === 'agent_say' && l.text), `${lines.length} lines`);
}

async function brokenDb() {
  const s = await start('db-corrupt', {}, ({ dir }) => fs.writeFileSync(path.join(dir, 'opencode.db'), Buffer.alloc(8192, 0x5a)));
  check('corrupt OpenCode DB: the board loads', (await s.api('/api/board')).status === 200);
  const task = await newTask(s, 'db');
  await s.api(`/api/tasks/${task.id}/run`, { method: 'POST', body: { prompt: 'hello' } });
  const done = await waitFor(async () => (await runState(s, task.id)) === 'idle', 30000);
  check('corrupt OpenCode DB: a turn still runs', done);
  check('corrupt OpenCode DB: the server keeps answering', await s.alive());
  await s.stop();
}

async function lockedDb() {
  let locker;
  const s = await start('db-locked', {}, ({ dir }) => {
    const file = path.join(dir, 'opencode.db');
    const script = `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(file)});
      db.exec("PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS session(id TEXT); BEGIN EXCLUSIVE; INSERT INTO session VALUES ('x');");
      process.stdout.write('locked\\n');
      setInterval(() => {}, 1000);`;
    locker = spawn('node', ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    execSync('sleep 1');
  });
  const started = Date.now();
  const board = await s.api('/api/board');
  check('locked OpenCode DB: the board loads, and promptly', board.status === 200 && Date.now() - started < 5000, `${Date.now() - started} ms`);
  await sleep(5000);
  check('locked OpenCode DB: the server keeps answering through a few polls', await s.alive());
  locker.kill('SIGKILL');
  await s.stop();
}

fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync('/sandbox/workspace', { recursive: true });
// `failure-paths.mjs noAgent lockedDb` runs just those.
const only = process.argv.slice(2);
const scenarios = [noAgent, corruptState, agentDiesMidTurn, socketsMisbehave, sigtermFlushes, brokenDb, lockedDb];
for (const scenario of scenarios.filter((s) => only.length === 0 || only.includes(s.name))) {
  const before = failures;
  try {
    await scenario();
  } catch (e) {
    check(`${scenario.name} ran to the end`, false, e instanceof Error ? e.message : String(e));
  }
  execSync("pkill -KILL -f '[f]akeAgent.mjs' || true");
  if (failures > before && process.env.SHOW_LOGS) {
    const dir = fs.readdirSync(ROOT).map((d) => path.join(ROOT, d)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
    console.log(`--- ${dir}/server.log (tail)\n${fs.readFileSync(path.join(dir, 'server.log'), 'utf-8').split('\n').slice(-40).join('\n')}`);
  }
}
console.log(failures === 0 ? 'all failure paths held' : `${failures} check(s) failed; server logs are under ${ROOT}`);
process.exit(failures === 0 ? 0 : 1);
