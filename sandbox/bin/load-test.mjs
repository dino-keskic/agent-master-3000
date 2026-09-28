#!/usr/bin/env node
/**
 * Load test for the board server, run inside the sandbox by `load-test.sh`.
 *
 *   load-test.mjs seed <file> <tasks>   write a board of <tasks> tasks with
 *                                       synthetic transcripts (~14 MB for 70)
 *   load-test.mjs run                   drive the server on $BOARD_URL
 *
 * `run` keeps $CLIENTS websockets attached, creates $TASKS tasks, runs $ROUNDS
 * turns on all of them at once (the fake agent's "stream" script) and prints
 * one JSON summary: websocket traffic, API latency, and how long each round
 * took. Server-side memory, event-loop delay and state-file writes come from
 * `probe.mjs`.
 */
import fs from 'fs';
import { performance } from 'perf_hooks';
import WebSocket from 'ws';

const { fetch } = globalThis;

const [mode, ...args] = process.argv.slice(2);

function filler(n, seed) {
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
  let out = '';
  for (let i = 0; out.length < n; i++) out += `${words[(i + seed) % words.length]} `;
  return out.slice(0, n);
}

/**
 * Roughly the shape of a real board: a quarter of the tasks at the 250-line
 * cap, the rest short, ~2.3 KB a line with tool calls carrying most of it.
 */
function seed(file, count) {
  const now = Date.now();
  const tasks = [];
  for (let t = 0; t < count; t++) {
    const logs = [];
    const lines = t % 4 === 0 ? 250 : 30;
    for (let l = 0; l < lines; l++) {
      const id = `seed-${t}-${l}`;
      const timestamp = now - (lines - l) * 1000;
      if (l % 5 === 0) {
        logs.push({ id, timestamp, type: 'agent_say', title: 'OpenCode Agent', text: filler(1200, l), sessionId: `ses_seed_${t}` });
      } else {
        logs.push({
          id, timestamp, type: 'tool_call', title: 'bash', text: filler(900, l), sessionId: `ses_seed_${t}`,
          toolCall: { toolCallId: id, name: 'bash', kind: 'execute', status: 'completed', rawInput: { command: filler(400, l) }, output: filler(900, l) }
        });
      }
    }
    tasks.push({
      id: `TASK-${t}`, title: `Seeded task ${t}`, description: filler(1200, t), prompt: filler(4000, t),
      originalPrompt: filler(4000, t), columnId: 'backlog', runState: 'idle', model: '', agent: '',
      thinkingLevel: 'default', cwd: '/sandbox/workspace', createdAt: now, updatedAt: now, logs
    });
  }
  fs.writeFileSync(file, JSON.stringify({ tasks, nextTaskNumber: count }));
  console.log(`seeded ${count} tasks, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

const BASE = process.env.BOARD_URL || 'http://127.0.0.1:3001';
const TASKS = Number(process.env.TASKS || 60);
const ROUNDS = Number(process.env.ROUNDS || 3);
const CLIENTS = Number(process.env.CLIENTS || 3);

function pct(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
}

async function timed(path, init) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json' },
    body: init?.body ? JSON.stringify(init.body) : undefined
  });
  const text = await res.text();
  return { ms: performance.now() - started, bytes: text.length, status: res.status, json: () => JSON.parse(text) };
}

async function run() {
  const ws = { messages: 0, bytes: 0, maxBytes: 0, byType: {} };
  const runState = new Map();
  const sockets = [];
  for (let i = 0; i < CLIENTS; i++) {
    const socket = new WebSocket(`${BASE.replace('http', 'ws')}/ws`);
    socket.on('message', (data) => {
      const size = data.length;
      ws.messages += 1;
      ws.bytes += size;
      ws.maxBytes = Math.max(ws.maxBytes, size);
      if (i !== 0) return;
      const msg = JSON.parse(data.toString());
      const bucket = (ws.byType[msg.type] ||= { n: 0, bytes: 0 });
      bucket.n += 1;
      bucket.bytes += size;
      if (msg.task) runState.set(msg.task.id, msg.task.runState);
    });
    await new Promise((resolve) => socket.once('open', resolve));
    sockets.push(socket);
  }

  const cheap = [];
  const board = [];
  let sampling = true;
  const sampler = (async () => {
    let n = 0;
    while (sampling) {
      cheap.push((await timed('/api/projects')).ms);
      if (n++ % 8 === 0) board.push(await timed('/api/board'));
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();

  const ids = [];
  for (let t = 0; t < TASKS; t++) {
    const created = await timed('/api/tasks', { method: 'POST', body: { title: `Load ${t}`, prompt: filler(3000, t), cwd: '/sandbox/workspace' } });
    ids.push(created.json().id);
  }

  const rounds = [];
  for (let r = 0; r < ROUNDS; r++) {
    const started = performance.now();
    const kicks = await Promise.all(ids.map((id) => timed(`/api/tasks/${id}/run`, { method: 'POST', body: { prompt: `round ${r}` } })));
    await new Promise((resolve) => setTimeout(resolve, 500));
    while (ids.some((id) => runState.get(id) === 'running')) await new Promise((resolve) => setTimeout(resolve, 200));
    rounds.push({ s: +((performance.now() - started) / 1000).toFixed(1), kickP99: pct(kicks.map((k) => k.ms), 0.99) });
  }

  const taskRead = await Promise.all(ids.slice(0, 10).map((id) => timed(`/api/tasks/${id}`)));
  sampling = false;
  await sampler;
  for (const socket of sockets) socket.close();

  console.log(JSON.stringify({
    tasks: TASKS, rounds, clients: CLIENTS,
    ws: { ...ws, mb: +(ws.bytes / 1e6).toFixed(1), perClientMb: +(ws.bytes / CLIENTS / 1e6).toFixed(1) },
    cheapApiMs: { p50: pct(cheap, 0.5), p99: pct(cheap, 0.99), max: pct(cheap, 1) },
    boardApi: { p50: pct(board.map((b) => b.ms), 0.5), max: pct(board.map((b) => b.ms), 1), kb: Math.round((board.at(-1)?.bytes ?? 0) / 1024) },
    taskApi: { p50: pct(taskRead.map((b) => b.ms), 0.5), kb: Math.round(taskRead[0].bytes / 1024) }
  }, null, 1));
}

if (mode === 'seed') seed(args[0], Number(args[1] || 70));
else await run();
