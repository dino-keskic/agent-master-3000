import test from 'node:test';
import assert from 'node:assert';
import {
  isTerminalTool,
  looksLikeDiff,
  omitKeys,
  skillNameOf,
  stripAnsi,
  summarizeToolCall,
  toolInputPath,
  toolOutputLanguage
} from '../../../shared/agent/toolCallView.js';
import { ToolCallInfo } from '../../../shared/types.js';

const call = (over: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  toolCallId: 't1',
  name: 'read',
  status: 'completed',
  ...over
});

test('a touched file is the summary, and the rest are counted', () => {
  assert.equal(summarizeToolCall(call({ locations: ['/repo/src/app/main.ts'] })), 'app/main.ts');
  assert.equal(
    summarizeToolCall(call({ locations: ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'] })),
    'repo/a.ts +2 more'
  );
});

test('with no location the most identifying input wins, in order', () => {
  assert.equal(summarizeToolCall(call({ rawInput: { command: 'ls', query: 'q' } })), 'ls');
  assert.equal(summarizeToolCall(call({ rawInput: { query: 'q', url: 'u' } })), 'q');
  assert.equal(summarizeToolCall(call({ rawInput: { filePath: '/a/b/c.ts' } })), 'b/c.ts');
  assert.equal(summarizeToolCall(call()), null, 'nothing to say beats saying nothing well');
  assert.equal(summarizeToolCall(call({ rawInput: { command: '  ' } })), null, 'blank is not a summary');
});

test('a long summary is cut, and a long path is still shortened after the cut', () => {
  const summary = summarizeToolCall(call({ rawInput: { command: 'x'.repeat(200) } }))!;
  assert.equal(summary.length, 73, '72 characters and an ellipsis');
  assert.ok(summary.endsWith('…'));
});

test('stripAnsi takes the colour out of shell output', () => {
  const esc = String.fromCharCode(27);
  assert.equal(stripAnsi(`${esc}[32mok${esc}[0m`), 'ok');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('a patch is recognised wherever it starts in the first lines', () => {
  assert.ok(looksLikeDiff('diff --git a/x b/x\n'));
  assert.ok(looksLikeDiff('Applied:\n@@ -1 +1 @@\n'));
  assert.ok(!looksLikeDiff('just some output'));
  // Past the window, so a long log that happens to quote a patch stays a log.
  assert.ok(!looksLikeDiff(`${'\n'.repeat(2100)}@@ -1 +1 @@`));
});

test("a read's output is coloured as the file it read", () => {
  assert.equal(toolOutputLanguage(call({ output: 'x', locations: ['/a/b.ts'] })), 'ts');
  assert.equal(toolOutputLanguage(call({ name: 'read', output: 'x' })), undefined, 'no path, no language');
  assert.equal(toolOutputLanguage(call({ name: 'read' })), undefined, 'no output, nothing to colour');
});

test('anything that prints a patch is coloured as a diff', () => {
  assert.equal(toolOutputLanguage(call({ name: 'bash', output: '@@ -1 +1 @@' })), 'diff');
  assert.equal(toolOutputLanguage(call({ name: 'bash', output: 'hello' })), undefined);
});

test('toolInputPath prefers the location the agent reported', () => {
  assert.equal(toolInputPath(call({ locations: ['/from/acp.ts'], rawInput: { path: '/from/input.ts' } })), '/from/acp.ts');
  assert.equal(toolInputPath(call({ rawInput: { path: '/from/input.ts' } })), '/from/input.ts');
  assert.equal(toolInputPath(call()), undefined);
});

test('a shell call is spotted by kind or by name', () => {
  assert.ok(isTerminalTool(call({ name: 'bash' })));
  assert.ok(isTerminalTool(call({ name: 'anything', kind: 'execute' })));
  assert.ok(isTerminalTool(call({ name: 'run_shell_command' })));
  assert.ok(!isTerminalTool(call({ name: 'read' })));
});

test('omitKeys keeps what is left, or says there is nothing left', () => {
  assert.deepEqual(omitKeys({ command: 'ls', cwd: '/repo' }, ['command']), { cwd: '/repo' });
  assert.equal(omitKeys({ command: 'ls' }, ['command']), null);
});

test('skillNameOf reads the skill from either agent\'s spelling', () => {
  assert.equal(skillNameOf({ name: 'skill', rawInput: { name: 'release-notes' } }), 'release-notes');
  assert.equal(skillNameOf({ name: 'Skill', rawInput: { skill: 'pdf' } }), 'pdf');
  assert.equal(skillNameOf({ name: 'skill' }), '');
  assert.equal(skillNameOf({ name: 'read', rawInput: { name: 'x' } }), undefined);
});
