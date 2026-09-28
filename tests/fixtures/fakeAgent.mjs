#!/usr/bin/env node
/**
 * A stand-in ACP agent, used to exercise the board's client half of the
 * protocol without spending money on a real model.
 *
 * OpenCode 1.18.15 never forwards its permission gate over ACP, so this is
 * currently the only way to drive `session/request_permission` and
 * `elicitation/create` through AcpManager end to end.
 *
 * Scripted by ACP_FAKE_SCRIPT: "permission" | "abandoned" | "elicitation" | "idle"
 * | "stream". "abandoned" asks for permission and then ends the turn without
 * waiting for an answer — what a real agent does when the tool call it was
 * asking about is cancelled under it. "stream" is for load tests
 * (`sandbox/bin/load-test.mjs`): every `session/new` is a new session, and a
 * prompt streams a thought, a reply in small chunks and a few tool calls with
 * sizeable output, then ends the turn — sized by ACP_FAKE_ROUNDS,
 * ACP_FAKE_CHUNKS and ACP_FAKE_CHUNK_MS. "demo" is "stream" for the screenshot board
 * (`sandbox/demo/`): it also offers a model, agent and effort list, and a turn in
 * one of the sessions named in ACP_FAKE_ASK_SESSIONS stops on a permission
 * request instead of streaming.
 */
import readline from 'readline';

const SCRIPT = process.env.ACP_FAKE_SCRIPT || 'permission';
let nextId = 1000;
let nextSession = 0;
const STREAMS = SCRIPT === 'stream' || SCRIPT === 'demo';
const ASK_SESSIONS = new Set((process.env.ACP_FAKE_ASK_SESSIONS || '').split(',').filter(Boolean));

/** What `session/new` offers in the demo: the dropdowns the board fills from it. */
function demoConfigOptions() {
  if (SCRIPT !== 'demo') return [];
  const select = (id, currentValue, options) => ({ id, currentValue, options });
  return [
    select('model', 'anthropic/claude-opus-5-5', [
      { value: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5' },
      { value: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' },
      { value: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5' },
      { value: 'openai/gpt-6', name: 'GPT-6' },
      { value: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
      { value: 'google/gemini-3-pro', name: 'Gemini 3 Pro' },
      { value: 'ollama/qwen3-coder-30b', name: 'Qwen3 Coder 30B (local)' },
      { value: 'ollama/devstral-2', name: 'Devstral 2 (local)' }
    ]),
    select('mode', 'build', [
      { value: 'build', name: 'build', description: 'Writes code, runs commands' },
      { value: 'plan', name: 'plan', description: 'Reads and plans, never edits' },
      { value: 'reviewer', name: 'reviewer', description: 'Reviews a diff against the ticket' }
    ]),
    select('effort', 'medium', [
      { value: 'low', name: 'Low' },
      { value: 'medium', name: 'Medium' },
      { value: 'high', name: 'High' }
    ])
  ];
}

const write = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const result = (id, res) => write({ jsonrpc: '2.0', id, result: res });
const request = (method, params) => {
  const id = ++nextId;
  write({ jsonrpc: '2.0', id, method, params });
  return id;
};

/** Requests we sent to the client, by id, so we can report the answer back. */
const outstanding = new Map();
let sessionId = null;
/** The in-flight `session/prompt` JSON-RPC id, so cancel can finish it. */
let promptRequestId = null;

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // A response to something we asked. Echo it so the test can assert on it.
  if (msg.id !== undefined && !msg.method && outstanding.has(msg.id)) {
    const kind = outstanding.get(msg.id);
    outstanding.delete(msg.id);
    write({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'answer',
          content: { type: 'text', text: `ANSWERED ${kind}: ${JSON.stringify(msg.result)}` }
        }
      }
    });
    return;
  }

  if (msg.method === 'initialize') {
    result(msg.id, { protocolVersion: 1, agentCapabilities: {} });
    return;
  }

  if (msg.method === 'session/new') {
    nextSession += 1;
    sessionId = STREAMS ? `ses_fake_${nextSession}` : 'ses_fake_1';
    result(msg.id, { sessionId, configOptions: demoConfigOptions() });
    return;
  }

  if (STREAMS && msg.method === 'session/load') {
    result(msg.id, { configOptions: demoConfigOptions() });
    return;
  }

  if (STREAMS && msg.method === 'session/prompt' && !ASK_SESSIONS.has(msg.params?.sessionId)) {
    streamTurn(msg.id, msg.params?.sessionId);
    return;
  }

  if (STREAMS && msg.method === 'session/cancel') {
    const turn = streaming.get(msg.params?.sessionId);
    if (turn) turn.cancelled = true;
    return;
  }

  if (msg.method === 'session/set_config_option') {
    result(msg.id, { configOptions: demoConfigOptions() });
    return;
  }

  if (msg.method === 'session/prompt') {
    promptRequestId = msg.id;
    if (SCRIPT === 'demo') sessionId = msg.params?.sessionId;
    if (SCRIPT === 'permission' || SCRIPT === 'abandoned' || SCRIPT === 'demo') {
      outstanding.set(
        request('session/request_permission', {
          sessionId,
          toolCall: {
            toolCallId: 'call_1',
            title: 'bash',
            kind: 'execute',
            status: 'pending',
            rawInput: SCRIPT === 'demo'
              ? { command: 'npx prisma migrate deploy', description: 'Apply the refund idempotency migration to the dev database' }
              : { command: 'rm -rf build' },
            locations: [{ path: SCRIPT === 'demo' ? '/sandbox/workspace/payments-api/prisma' : '/tmp/project/build' }]
          },
          options: [
            { optionId: 'rej', name: 'Reject', kind: 'reject_once' },
            { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'always', name: 'Always allow', kind: 'allow_always' }
          ]
        }),
        'permission'
      );
    } else if (SCRIPT === 'elicitation') {
      outstanding.set(
        request('elicitation/create', {
          message: 'Which environment should I deploy to?',
          mode: 'form',
          requestedSchema: {
            type: 'object',
            properties: {
              environment: { type: 'string', title: 'Environment', enum: ['staging', 'production'] },
              notes: { type: 'string', title: 'Notes', description: 'Anything I should know' },
              confirm: { type: 'boolean', title: 'I understand this is irreversible' }
            },
            required: ['environment']
          }
        }),
        'elicitation'
      );
    }

    // A real agent blocked on a permission request does not end its turn, so
    // neither do we — the harness kills the process when it is done. Unless the
    // script is the one about abandoning the request mid-flight.
    const delay = SCRIPT === 'abandoned' ? 50 : 10 * 60_000;
    setTimeout(() => {
      if (promptRequestId === msg.id) promptRequestId = null;
      result(msg.id, { stopReason: 'end_turn' });
    }, delay).unref?.();
    return;
  }

  if (msg.method === 'session/cancel' || msg.method === 'session/abort' || msg.method === 'session/close') {
    // `session/cancel` is a notification (no id). A request-shaped cancel is
    // still answered so older clients do not hang, then the prompt is finished.
    if (msg.id !== undefined) result(msg.id, {});
    if (promptRequestId !== null) {
      result(promptRequestId, { stopReason: 'cancelled' });
      promptRequestId = null;
    }
  }
});

/** Session id -> the turn it is streaming, so a cancel can end it early. */
const streaming = new Map();

const WORDS = 'the board streams each chunk of this reply to every browser that is watching it'.split(' ');

/** A demo turn's lines: what a coding agent says while it works through a change. */
const DEMO_THOUGHT = 'The cart store is read in eleven components. Converting the selectors first keeps every render path typed while the actions move over. ';
const DEMO_REPLY = [
  'Moving the cart slice over to a Zustand store. The selectors stay name-compatible, so the components change one import each. ',
  'Next the async thunks: `addItem` and `applyCoupon` become plain store actions that call the API client directly. ',
  'Last, the persistence middleware: the old redux-persist key is read once on boot so nobody loses a cart on deploy. '
];
const DEMO_TOOLS = [
  { title: 'read', kind: 'read', rawInput: { filePath: '/sandbox/workspace/storefront-web/src/store/cartSlice.ts' } },
  { title: 'edit', kind: 'edit', rawInput: { filePath: '/sandbox/workspace/storefront-web/src/store/cart.ts' } },
  { title: 'bash', kind: 'execute', rawInput: { command: 'pnpm vitest run src/store', description: 'Run the store tests' } }
];

function words(n, seed) {
  let out = '';
  for (let i = 0; i < n; i++) out += `${WORDS[(i + seed) % WORDS.length]} `;
  return out;
}

/** One "stream" turn: a thought, then rounds of reply chunks and a tool call. */
async function streamTurn(promptId, sid) {
  const rounds = Number(process.env.ACP_FAKE_ROUNDS || 3);
  const chunks = Number(process.env.ACP_FAKE_CHUNKS || 40);
  const pause = Number(process.env.ACP_FAKE_CHUNK_MS || 20);
  const turn = { cancelled: false };
  streaming.set(sid, turn);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const update = (u) => write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: u } });
  const stamp = `${sid}_${promptId}`;

  const demo = SCRIPT === 'demo';
  const piece = (text, i, n) => text.split(' ').slice(Math.floor((i * text.split(' ').length) / n), Math.floor(((i + 1) * text.split(' ').length) / n)).join(' ') + ' ';
  for (let i = 0; i < 5 && !turn.cancelled; i++) {
    update({ sessionUpdate: 'agent_thought_chunk', messageId: `${stamp}_t`, content: { type: 'text', text: demo ? piece(DEMO_THOUGHT, i, 5) : words(8, i) } });
    await sleep(pause);
  }
  for (let r = 0; r < rounds && !turn.cancelled; r++) {
    const messageId = `${stamp}_m${r}`;
    for (let c = 0; c < chunks && !turn.cancelled; c++) {
      const text = demo ? piece(DEMO_REPLY[r % DEMO_REPLY.length], c, chunks) : words(6, c);
      update({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } });
      await sleep(pause);
    }
    const toolCallId = `${stamp}_tool${r}`;
    const tool = demo
      ? DEMO_TOOLS[r % DEMO_TOOLS.length]
      : { title: 'bash', kind: 'execute', rawInput: { command: `npm test -- --grep round${r}`, description: words(10, r) } };
    update({ sessionUpdate: 'tool_call', toolCallId, ...tool, status: 'pending' });
    await sleep(pause);
    update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });
    await sleep(pause);
    update({
      sessionUpdate: 'tool_call_update', toolCallId, status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: demo ? '✓ src/store/cart.test.ts (14 tests) 212ms' : words(400, r) } }]
    });
    await sleep(pause);
  }
  streaming.delete(sid);
  result(promptId, { stopReason: turn.cancelled ? 'cancelled' : 'end_turn' });
}
