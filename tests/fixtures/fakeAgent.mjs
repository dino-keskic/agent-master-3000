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
 * ACP_FAKE_CHUNKS and ACP_FAKE_CHUNK_MS.
 */
import readline from 'readline';

const SCRIPT = process.env.ACP_FAKE_SCRIPT || 'permission';
let nextId = 1000;
let nextSession = 0;

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
    sessionId = SCRIPT === 'stream' ? `ses_fake_${nextSession}` : 'ses_fake_1';
    result(msg.id, { sessionId, configOptions: [] });
    return;
  }

  if (SCRIPT === 'stream' && msg.method === 'session/load') {
    result(msg.id, { configOptions: [] });
    return;
  }

  if (SCRIPT === 'stream' && msg.method === 'session/prompt') {
    streamTurn(msg.id, msg.params?.sessionId);
    return;
  }

  if (SCRIPT === 'stream' && msg.method === 'session/cancel') {
    const turn = streaming.get(msg.params?.sessionId);
    if (turn) turn.cancelled = true;
    return;
  }

  if (msg.method === 'session/set_config_option') {
    result(msg.id, { configOptions: [] });
    return;
  }

  if (msg.method === 'session/prompt') {
    promptRequestId = msg.id;
    if (SCRIPT === 'permission' || SCRIPT === 'abandoned') {
      outstanding.set(
        request('session/request_permission', {
          sessionId,
          toolCall: {
            toolCallId: 'call_1',
            title: 'bash',
            kind: 'execute',
            status: 'pending',
            rawInput: { command: 'rm -rf build' },
            locations: [{ path: '/tmp/project/build' }]
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

  for (let i = 0; i < 5 && !turn.cancelled; i++) {
    update({ sessionUpdate: 'agent_thought_chunk', messageId: `${stamp}_t`, content: { type: 'text', text: words(8, i) } });
    await sleep(pause);
  }
  for (let r = 0; r < rounds && !turn.cancelled; r++) {
    const messageId = `${stamp}_m${r}`;
    for (let c = 0; c < chunks && !turn.cancelled; c++) {
      update({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: words(6, c) } });
      await sleep(pause);
    }
    const toolCallId = `${stamp}_tool${r}`;
    update({
      sessionUpdate: 'tool_call', toolCallId, title: 'bash', kind: 'execute', status: 'pending',
      rawInput: { command: `npm test -- --grep round${r}`, description: words(10, r) }
    });
    await sleep(pause);
    update({ sessionUpdate: 'tool_call_update', toolCallId, status: 'in_progress' });
    await sleep(pause);
    update({
      sessionUpdate: 'tool_call_update', toolCallId, status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: words(400, r) } }]
    });
    await sleep(pause);
  }
  streaming.delete(sid);
  result(promptId, { stopReason: turn.cancelled ? 'cancelled' : 'end_turn' });
}
