import test from 'node:test';
import assert from 'node:assert';
import { isSubagentTool, toolKind } from '../../../shared/agent/toolCall.js';

test('both OpenCode shells run commands', () => {
  assert.strictEqual(toolKind('bash'), 'execute');
  assert.strictEqual(toolKind('shell'), 'execute');
  assert.strictEqual(toolKind(' Shell '), 'execute');
});

test("OpenCode 2's execute is Code Mode, not a shell", () => {
  assert.strictEqual(toolKind('execute'), 'other');
});

test('names it does not know are other', () => {
  assert.strictEqual(toolKind('sandbox-echo_echo'), 'other');
  assert.strictEqual(toolKind('write'), 'edit');
});

test('both spellings of a handoff are subagent calls', () => {
  assert.ok(isSubagentTool('task'));
  assert.ok(isSubagentTool('subagent'));
  assert.ok(!isSubagentTool('execute'));
  assert.ok(!isSubagentTool(undefined));
});
