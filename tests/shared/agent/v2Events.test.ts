import test from 'node:test';
import assert from 'node:assert';
import {
  V2_PERMISSION_OPTIONS,
  historyUpdates,
  snapshotUpdates,
  textLogId,
  translateV2Event,
  v2RowEndsTurn,
  type V2Event,
  type V2MessageRow,
  type V2Output
} from '../../../shared/agent/v2Events.js';

// Shapes as OpenCode 2.0.24's `/api/event` sends them.
const S = 'ses_1';
const M = 'msg_a';
/** The one output an event gives. */
function one(event: V2Event): V2Output {
  const out = translateV2Event(event);
  assert.strictEqual(out.length, 1);
  return out[0]!;
}

const ev = (type: string, data: Record<string, unknown>) => ({ type, data: { sessionID: S, ...data } });

test('translateV2Event', async (t) => {
  await t.test('streams text into one log row per part, and replaces it when the part ends', () => {
    const delta = one(ev('session.text.delta', { assistantMessageID: M, ordinal: 2, delta: 'Hel' }));
    assert.deepStrictEqual(delta, {
      kind: 'update',
      sessionId: S,
      update: { sessionUpdate: 'agent_message_chunk', messageId: M, content: { type: 'text', text: 'Hel' }, _meta: { logId: textLogId(M, 2) } }
    });
    const ended = one(ev('session.text.ended', { assistantMessageID: M, ordinal: 2, text: 'Hello' }));
    assert.ok(ended.kind === 'update');
    assert.deepStrictEqual(ended.update._meta, { logId: textLogId(M, 2), replace: true });
    assert.deepStrictEqual(ended.update.content, { type: 'text', text: 'Hello' });
  });

  await t.test('reasoning is a thought', () => {
    const out = one(ev('session.reasoning.delta', { assistantMessageID: M, ordinal: 0, delta: 'hmm' }));
    assert.ok(out.kind === 'update');
    assert.strictEqual(out.update.sessionUpdate, 'agent_thought_chunk');
  });

  await t.test('follows a tool from its name to its result', () => {
    const started = one(ev('session.tool.input.started', { assistantMessageID: M, id: 'call_1', name: 'shell' }));
    assert.ok(started.kind === 'update');
    assert.deepStrictEqual(started.update, { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'shell', kind: 'execute', status: 'pending' });

    const input = one(ev('session.tool.input.ended', { id: 'call_1', text: '{"command":"ls"}' }));
    assert.ok(input.kind === 'update');
    assert.deepStrictEqual(input.update.rawInput, { command: 'ls' });

    const called = one(ev('session.tool.called', { id: 'call_1', input: { command: 'ls' } }));
    assert.ok(called.kind === 'update');
    assert.strictEqual(called.update.status, 'in_progress');

    const done = one(ev('session.tool.success', { id: 'call_1', content: [{ type: 'text', text: 'a\nb' }], metadata: { exit: 0 } }));
    assert.ok(done.kind === 'update');
    assert.strictEqual(done.update.status, 'completed');
    assert.deepStrictEqual(done.update.content, [{ type: 'content', content: { type: 'text', text: 'a\nb' } }]);
  });

  await t.test('a half-written tool input is no update', () => {
    assert.deepStrictEqual(translateV2Event(ev('session.tool.input.ended', { id: 'call_1', text: '{"comm' })), []);
  });

  await t.test('a failed tool says why', () => {
    const out = one(ev('session.tool.error', { id: 'call_1', error: { message: 'boom' } }));
    assert.ok(out.kind === 'update');
    assert.strictEqual(out.update.status, 'failed');
    assert.deepStrictEqual(out.update.content, [{ type: 'content', content: { type: 'text', text: 'boom' } }]);
  });

  await t.test('asks for a permission on the tool call that wants it', () => {
    const out = one({
      type: 'permission.asked',
      data: { id: 'per_1', sessionID: S, action: 'shell', resources: ['ls -la'], save: [], source: { type: 'tool', messageID: M, id: 'call_1' } }
    });
    assert.deepStrictEqual(out, {
      kind: 'permission',
      sessionId: S,
      requestId: 'per_1',
      params: {
        sessionId: S,
        title: 'shell: ls -la',
        toolCall: { toolCallId: 'call_1', title: 'shell', kind: 'execute', status: 'pending' },
        options: V2_PERMISSION_OPTIONS
      }
    });
  });

  await t.test('hears a permission answered elsewhere', () => {
    assert.deepStrictEqual(translateV2Event({ type: 'permission.replied', data: { sessionID: S, requestID: 'per_1', reply: 'once' } }), [
      { kind: 'permission_settled', sessionId: S, requestId: 'per_1' }
    ]);
  });

  await t.test('a rename is a title', () => {
    const out = one(ev('session.renamed', { title: 'Fix it' }));
    assert.ok(out.kind === 'update');
    assert.deepStrictEqual(out.update, { sessionUpdate: 'session_info_update', title: 'Fix it' });
  });

  await t.test('turn edges', () => {
    assert.deepStrictEqual(translateV2Event(ev('session.execution.started', {})), [{ kind: 'turn_started', sessionId: S }]);
    assert.deepStrictEqual(translateV2Event(ev('session.execution.succeeded', {})), [{ kind: 'turn_ended', sessionId: S, stopReason: 'end_turn' }]);
    assert.deepStrictEqual(translateV2Event(ev('session.execution.interrupted', {})), [{ kind: 'turn_ended', sessionId: S, stopReason: 'cancelled' }]);
    assert.deepStrictEqual(translateV2Event(ev('session.execution.failed', { error: { message: 'no key' } })), [
      { kind: 'turn_ended', sessionId: S, stopReason: 'refusal', error: 'no key' }
    ]);
  });

  await t.test('ignores bookkeeping and frames without a session', () => {
    assert.deepStrictEqual(translateV2Event(ev('session.usage.updated', {})), []);
    assert.deepStrictEqual(translateV2Event(ev('session.step.started', { assistantMessageID: M })), []);
    assert.deepStrictEqual(translateV2Event({ type: 'server.connected', data: {} }), []);
    assert.deepStrictEqual(translateV2Event({ type: 'session.text.delta' }), []);
  });
});

test('snapshotUpdates', async (t) => {
  const rows: V2MessageRow[] = [
    { id: 'msg_old', type: 'assistant', content: [{ type: 'text', text: 'earlier turn' }] },
    { id: 'msg_u', type: 'user', text: 'go' },
    {
      id: M,
      type: 'assistant',
      content: [
        { type: 'reasoning', text: 'plan' },
        { type: 'text', text: 'Looking.' },
        { type: 'tool', id: 'call_1', name: 'shell', state: { status: 'running', input: { command: 'ls' } } },
        { type: 'text', text: '' }
      ]
    },
    { id: 'syn', type: 'synthetic', metadata: { notice: 'restart' } }
  ];

  await t.test('is the turn since the last prompt, under the ids the live events use', () => {
    const updates = snapshotUpdates(rows);
    assert.deepStrictEqual(
      updates.map((u) => [u.sessionUpdate, (u._meta as { logId?: string } | undefined)?.logId ?? u.toolCallId]),
      [
        ['agent_thought_chunk', `v2:${M}:reasoning:0`],
        ['agent_message_chunk', textLogId(M, 0)],
        ['tool_call', 'call_1']
      ]
    );
    assert.strictEqual(updates[2]!.status, 'in_progress');
    assert.strictEqual(updates[2]!.kind, 'execute');
    assert.deepStrictEqual(updates[2]!.rawInput, { command: 'ls' });
  });

  await t.test('a finished tool carries its output', () => {
    const tool = snapshotUpdates([
      { id: M, type: 'assistant', content: [{ type: 'tool', id: 'c', name: 'read', state: { status: 'completed', content: [{ type: 'text', text: 'x' }] } }] }
    ])[0]!;
    assert.strictEqual(tool.status, 'completed');
    assert.deepStrictEqual(tool.content, [{ type: 'content', content: { type: 'text', text: 'x' } }]);
  });
});

test('historyUpdates replays every prompt and answer', () => {
  const updates = historyUpdates([
    { id: 'u1', type: 'user', text: 'hi' },
    { id: 'a1', type: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    { id: 'i1', type: 'idle', outcome: 'succeeded' },
    { id: 'u2', type: 'user', text: '' }
  ]);
  assert.deepStrictEqual(updates.map((u) => u.sessionUpdate), ['user_message_chunk', 'agent_message_chunk']);
  assert.deepStrictEqual(updates[0]!._meta, { logId: 'v2:u1:user', replace: true });
});

test('v2RowEndsTurn', () => {
  assert.strictEqual(v2RowEndsTurn('idle', { outcome: 'succeeded' }), true);
  assert.strictEqual(v2RowEndsTurn('assistant', { error: { type: 'aborted' } }), true);
  assert.strictEqual(v2RowEndsTurn('assistant', { finish: 'tool-calls' }), false);
  assert.strictEqual(v2RowEndsTurn('synthetic', {}), false);
  assert.strictEqual(v2RowEndsTurn(null, null), false);
});
