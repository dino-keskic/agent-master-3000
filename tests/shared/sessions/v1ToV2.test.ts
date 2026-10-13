import test from 'node:test';
import assert from 'node:assert';
import { V1MessageRow, V1PartRow, convertV1Session } from '../../../shared/sessions/v1ToV2.js';

const S = 'ses_a';
let clock = 1_000;

function message(id: string, data: object, updated?: number): V1MessageRow {
  const created = clock++;
  return { id, session_id: S, time_created: created, time_updated: updated ?? created, data: JSON.stringify(data) };
}

function part(id: string, messageId: string, data: object): V1PartRow {
  return { id, message_id: messageId, session_id: S, time_created: clock, time_updated: clock, data: JSON.stringify(data) };
}

const model = { providerID: 'stub', modelID: 'm' };
const answer = (parentID: string, extra: object = {}) => ({
  role: 'assistant', parentID, agent: 'build', mode: 'build', ...model, cost: 1,
  tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 4 } }, time: { created: 0, completed: 1 }, ...extra
});

test('an empty session has no rows and a watermark before the first', () => {
  const out = convertV1Session({ id: S }, [], []);
  assert.deepStrictEqual(out.messages, []);
  assert.strictEqual(out.watermark, -1);
  assert.strictEqual(out.session.cost, 0);
});

test('prompts and answers become one row each, numbered in order', () => {
  const rows = [
    message('msg_1', { role: 'user', agent: 'plan', model: { ...model, variant: 'high' }, time: { created: 0 } }),
    message('msg_2', answer('msg_1', { finish: 'end_turn' }), 9_999)
  ];
  const parts = [
    part('prt_1', 'msg_1', { type: 'text', text: 'hello' }),
    part('prt_2', 'msg_2', { type: 'text', text: 'hi', metadata: { a: 1 } }),
    part('prt_3', 'msg_2', { type: 'tool', tool: 'read', callID: 'c1', state: { status: 'error', input: { filePath: 'x' }, error: 'nope', time: { start: 5, end: 6 } } }),
    part('prt_4', 'msg_2', { type: 'tool', tool: 'grep', callID: 'c2', state: { status: 'pending', input: {} } })
  ];
  const out = convertV1Session({ id: S }, rows, parts);
  assert.deepStrictEqual(out.messages.map((m) => [m.type, m.seq]), [['user', 0], ['assistant', 1], ['system', 2]]);
  assert.strictEqual(out.messages[0]!.data.text, 'hello');
  const reply = out.messages[1]!.data;
  assert.strictEqual(reply.finish, 'unknown', 'a finish reason 2.x does not know');
  assert.deepStrictEqual(reply.model, { providerID: 'stub', id: 'm', variant: 'default' });
  assert.deepStrictEqual(reply.time, { created: rows[1]!.time_created, completed: 9_999 });
  assert.deepStrictEqual(reply.content[0], { type: 'text', text: 'hi', state: { a: 1 } });
  assert.deepStrictEqual(reply.content[1].state.error, { type: 'tool.execution', message: 'nope' });
  assert.strictEqual(reply.content[2].state.error.type, 'tool.interrupted');
  assert.match(out.messages[2]!.data.text, /`read` tool now takes `path`/);
  assert.ok(out.messages[2]!.id > out.messages[1]!.id.slice(0, 16), 'the notice sorts with the row it follows');
  assert.strictEqual(out.watermark, 2);
  assert.deepStrictEqual(out.session, {
    agent: 'plan',
    model: JSON.stringify({ id: 'm', providerID: 'stub', variant: 'high' }),
    cost: 1, tokens_input: 10, tokens_output: 5, tokens_reasoning: 2, tokens_cache_read: 3, tokens_cache_write: 4
  });
});

test("the session's own agent and model win over the last prompt's", () => {
  const out = convertV1Session({ id: S, agent: 'review', model: '{"id":"x"}' }, [message('msg_1', { role: 'user', agent: 'plan', model })], []);
  assert.strictEqual(out.session.agent, 'review');
  assert.strictEqual(out.session.model, '{"id":"x"}');
});

test('a compaction folds its summary in and quotes what it kept', () => {
  const rows = [
    message('msg_1', { role: 'user', agent: 'build', model }),
    message('msg_2', answer('msg_1')),
    message('msg_3', { role: 'user', agent: 'build', model }),
    message('msg_4', answer('msg_3', { summary: true, cost: 2 }), 50_000)
  ];
  const parts = [
    part('prt_1', 'msg_1', { type: 'text', text: 'first' }),
    part('prt_2', 'msg_2', { type: 'reasoning', text: 'hmm', time: { start: 1 } }),
    part('prt_3', 'msg_2', { type: 'text', text: 'reply' }),
    part('prt_4', 'msg_3', { type: 'compaction', auto: true, tail_start_id: 'msg_1' }),
    part('prt_5', 'msg_4', { type: 'text', text: 'the summary' })
  ];
  const out = convertV1Session({ id: S }, rows, parts);
  assert.deepStrictEqual(out.messages.map((m) => m.type), ['user', 'assistant', 'compaction']);
  const compaction = out.messages[2]!;
  assert.strictEqual(compaction.data.summary, 'the summary');
  assert.strictEqual(compaction.data.reason, 'auto');
  assert.strictEqual(compaction.data.recent, '[User]: first\n\n[Assistant reasoning]: hmm\n\n[Assistant]: reply');
  assert.strictEqual(compaction.time_updated, 50_000);
  assert.strictEqual(out.session.cost, 3, 'the summary was paid for too');
});

test('a prompt that only started a subagent is left to the subagent', () => {
  const rows = [message('msg_1', { role: 'user', agent: 'build', model }), message('msg_2', answer('msg_1'))];
  const parts = [
    part('prt_1', 'msg_1', { type: 'subtask', agent: 'general', prompt: 'p' }),
    part('prt_2', 'msg_2', { type: 'tool', tool: 'task', callID: 'c', state: { status: 'completed', input: {}, output: 'ok', time: { start: 1, end: 2 } } })
  ];
  assert.deepStrictEqual(convertV1Session({ id: S }, rows, parts).messages, []);
});

test('synthetic text is a row of its own beside the typed prompt', () => {
  const rows = [message('msg_1', { role: 'user', agent: 'build', model })];
  const parts = [
    part('prt_1', 'msg_1', { type: 'text', text: 'typed' }),
    part('prt_2', 'msg_1', { type: 'text', text: 'injected', synthetic: true }),
    part('prt_3', 'msg_1', { type: 'text', text: 'hidden', ignored: true }),
    part('prt_4', 'msg_1', { type: 'file', url: 'data:text/plain,hi%20there', mime: 'text/plain', filename: 'a.txt' }),
    part('prt_5', 'msg_1', { type: 'file', url: 'file:///tmp/b.png', mime: 'image/png' })
  ];
  const out = convertV1Session({ id: S }, rows, parts);
  assert.deepStrictEqual(out.messages.map((m) => m.type), ['user', 'synthetic']);
  assert.strictEqual(out.messages[0]!.data.text, 'typed\n\n[Attachment unavailable after migration: file:///tmp/b.png (image/png)]');
  assert.deepStrictEqual(out.messages[0]!.data.files, [{ data: 'aGkgdGhlcmU=', mime: 'text/plain', source: { type: 'inline' }, name: 'a.txt' }]);
  assert.strictEqual(out.messages[1]!.data.text, 'injected');
  assert.notStrictEqual(out.messages[1]!.id, 'msg_1');
});

test('unreadable rows are skipped, not fatal', () => {
  const rows = [
    message('msg_1', { role: 'user' }),
    { ...message('msg_2', {}), data: '{not json' },
    message('msg_3', answer('msg_1', { error: { name: 'MessageOutputLengthError', data: {} } }))
  ];
  const parts = [
    { ...part('prt_1', 'msg_1', {}), data: '[]' },
    part('prt_2', 'msg_gone', { type: 'text', text: 'x' })
  ];
  const out = convertV1Session({ id: S }, rows, parts);
  assert.deepStrictEqual(out.skipped.map((s) => s.reason).sort(), ['invalid-message', 'invalid-part', 'orphan-part']);
  assert.deepStrictEqual(out.messages[1]!.data.error, { type: 'provider.invalid-output', message: 'The model exceeded its output limit' });
});
