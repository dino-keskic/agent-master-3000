import test from 'node:test';
import assert from 'node:assert';
import { foldSteps, stepsSummary } from '../../../shared/transcript/steps.js';
import { TaskLogItem, ToolCallStatus } from '../../../shared/types.js';

/** A run of tool calls between two messages reads as one line. */

let seq = 0;
function say(type: 'user_say' | 'agent_say' | 'thought', text = 'x'): TaskLogItem {
  return { id: `l${++seq}`, timestamp: seq, type, text };
}
function call(name: string, status: ToolCallStatus = 'completed', kind?: string): TaskLogItem {
  const id = `l${++seq}`;
  return { id, timestamp: seq, type: 'tool_call', text: '', toolCall: { toolCallId: id, name, status, kind } };
}

test('consecutive calls fold into one block with a tally', () => {
  const logs = [say('user_say'), call('read'), call('read'), say('thought'), call('edit'), call('bash'), say('agent_say')];
  const blocks = foldSteps(logs);
  assert.deepStrictEqual(blocks.map((block) => block.kind), ['entry', 'steps', 'entry']);
  const steps = blocks[1];
  assert.ok(steps?.kind === 'steps');
  assert.strictEqual(steps.index, 1);
  assert.strictEqual(steps.logs.length, 5);
  assert.strictEqual(steps.summary, '4 steps · read 2 files, edited 1, ran 1 command');
  assert.strictEqual(steps.live, false);
});

test('a single call stays as it is', () => {
  const blocks = foldSteps([say('user_say'), say('thought'), call('grep'), say('agent_say')]);
  assert.deepStrictEqual(blocks.map((block) => block.kind), ['entry', 'entry', 'entry', 'entry']);
  assert.deepStrictEqual(blocks.map((block) => block.index), [0, 1, 2, 3]);
});

test('a subagent call is a doorway and is never folded away', () => {
  const blocks = foldSteps([call('read'), call('read'), call('task'), call('read')]);
  assert.deepStrictEqual(blocks.map((block) => block.kind), ['steps', 'entry', 'entry']);
});

test('a run still in flight is live, and failures are counted', () => {
  const [block] = foldSteps([call('read', 'failed'), call('bash', 'in_progress')]);
  assert.ok(block?.kind === 'steps');
  assert.strictEqual(block.live, true);
  assert.strictEqual(block.failed, 1);
});

test('unnamed tools fall back to the kind the agent reported', () => {
  assert.strictEqual(stepsSummary([call('mcp_thing', 'completed', 'fetch'), call('odd')]), '2 steps · fetched 1 page, 1 other call');
});
