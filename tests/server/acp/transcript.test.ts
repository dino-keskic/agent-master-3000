import test from 'node:test';
import assert from 'node:assert';
import { AcpSessionRegistry } from '../../../server/acp/sessionRegistry.js';
import { TranscriptStream } from '../../../server/acp/transcript.js';
import { MAX_LOG_TEXT } from '../../../shared/task/logWrites.js';
import { TaskLogItem } from '../../../shared/types.js';

const chunk = (text: string, messageId?: string) => ({ kind: 'agent_chunk' as const, messageId, text });
const logOf = (event: ReturnType<TranscriptStream['toEvent']>): TaskLogItem => {
  assert.ok(event && event.type === 'log' && event.log);
  return event.log;
};

test('chunks of one message accumulate under one log id until its turn settles', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const first = logOf(stream.toEvent('TASK-1', chunk('Hello, ', 'm1'), 'ses-a'));
  const second = logOf(stream.toEvent('TASK-1', chunk('world', 'm1'), 'ses-a'));
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(second.text, 'Hello, world');

  stream.forgetSession('ses-a');
  const after = logOf(stream.toEvent('TASK-1', chunk('next turn'), 'ses-a'));
  assert.notStrictEqual(after.id, first.id);
  assert.strictEqual(after.text, 'next turn');
});

test('an agent that sends no message id gets a fresh line per turn, not one line forever', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const turn1 = logOf(stream.toEvent('TASK-1', chunk('one'), 'ses-a'));
  stream.forgetSession('ses-a');
  const turn2 = logOf(stream.toEvent('TASK-1', chunk('two'), 'ses-a'));
  assert.notStrictEqual(turn2.id, turn1.id);
  assert.strictEqual(turn2.text, 'two');
});

test('settling one session leaves another session of the same task streaming', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const fork = logOf(stream.toEvent('TASK-1', chunk('fork says ', 'm'), 'ses-fork'));
  logOf(stream.toEvent('TASK-1', chunk('main says', 'm'), 'ses-main'));
  stream.forgetSession('ses-main');
  const more = logOf(stream.toEvent('TASK-1', chunk('more', 'm'), 'ses-fork'));
  assert.strictEqual(more.id, fork.id);
  assert.strictEqual(more.text, 'fork says more');

  stream.forgetTask('TASK-1');
  assert.notStrictEqual(logOf(stream.toEvent('TASK-1', chunk('x', 'm'), 'ses-fork')).id, fork.id);
});

test('a tool call keeps what earlier updates said about it within the turn', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const update = (u: Record<string, unknown>) => ({ kind: 'tool_call' as const, update: { toolCallId: 'call-1', ...u } });
  stream.toEvent('TASK-1', update({ title: 'bash', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } }), 'ses-a');
  const done = logOf(stream.toEvent('TASK-1', update({ status: 'completed' }), 'ses-a'));
  assert.deepStrictEqual(done.toolCall?.rawInput, { command: 'ls' });
});

test('a Code Mode call shows what its script calls, then what it reported running', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const update = (u: Record<string, unknown>) => ({ kind: 'tool_call' as const, update: { toolCallId: 'cm-1', ...u } });
  stream.toEvent('TASK-1', update({ title: 'execute', kind: 'other', status: 'pending' }), 'ses-a');
  const running = logOf(stream.toEvent('TASK-1', update({
    status: 'in_progress',
    rawInput: { code: 'await tools["echo-board"].echo({ text: "hi" })' }
  }), 'ses-a'));
  assert.deepStrictEqual(running.toolCall?.codeModeCalls, ['echo-board.echo']);

  const done = logOf(stream.toEvent('TASK-1', update({
    status: 'completed',
    rawOutput: { metadata: { toolCalls: [{ tool: 'echo-board.echo' }, { tool: 'echo-board.echo' }] } }
  }), 'ses-a'));
  assert.deepStrictEqual(done.toolCall?.codeModeCalls, ['echo-board.echo', 'echo-board.echo']);

  const late = logOf(stream.toEvent('TASK-1', update({ status: 'completed' }), 'ses-a'));
  assert.deepStrictEqual(late.toolCall?.codeModeCalls, ['echo-board.echo', 'echo-board.echo'], 'the report is kept');
});

test('a message longer than the store keeps stops growing in memory', () => {
  const stream = new TranscriptStream(new AcpSessionRegistry());
  const piece = 'x'.repeat(1000);
  let text = '';
  for (let i = 0; i < 50; i++) text = logOf(stream.toEvent('TASK-1', chunk(piece, 'm'), 'ses-a')).text;
  assert.ok(text.length > MAX_LOG_TEXT, 'still at least what the store keeps');
  assert.ok(text.length <= MAX_LOG_TEXT + piece.length);
});
