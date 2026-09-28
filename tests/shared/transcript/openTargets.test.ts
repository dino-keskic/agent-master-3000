import test from 'node:test';
import assert from 'node:assert';
import { pathNamedIn, transcriptNamesPath } from '../../../shared/transcript/openTargets.js';
import { TaskLogItem } from '../../../shared/types.js';

const log = (partial: Partial<TaskLogItem>): TaskLogItem => ({
  id: 'l1',
  timestamp: 1,
  type: 'agent_say',
  text: '',
  ...partial
});

test('a path is named when the text stops where the path does', () => {
  assert.ok(pathNamedIn('see /tmp/build/out.log for details', '/tmp/build/out.log'));
  assert.ok(pathNamedIn('`/tmp/build/out.log`', '/tmp/build/out.log'));
  assert.ok(pathNamedIn('/tmp/build/out.log:42 failed', '/tmp/build/out.log'));
  assert.ok(pathNamedIn('/tmp/build/out.log', '/tmp/build/out.log'));
});

test('naming a file does not authorise opening the folders above it', () => {
  const text = 'wrote /Users/me/project/src/a.ts';
  assert.ok(pathNamedIn(text, '/Users/me/project/src/a.ts'));
  // Opening a directory in an editor is a much bigger thing than opening a file.
  assert.ok(!pathNamedIn(text, '/Users/me/project'));
  assert.ok(!pathNamedIn(text, '/Users'));
  // Nor a sibling that merely shares the prefix.
  assert.ok(!pathNamedIn(text, '/Users/me/project/src/a.t'));
});

test('reads a percent-encoded file URL as the path it points at', () => {
  assert.ok(pathNamedIn('[notes](file:///tmp/my%20notes.md)', '/tmp/my notes.md'));
  // A stray `%` is not an encoding; the raw text still counts.
  assert.ok(pathNamedIn('100% at /tmp/out.log', '/tmp/out.log'));
});

test('nothing is named by an empty transcript, or by nothing', () => {
  assert.ok(!pathNamedIn(undefined, '/tmp/a.log'));
  assert.ok(!pathNamedIn('/tmp/a.log', ''));
  assert.ok(!transcriptNamesPath([], '/tmp/a.log'));
  assert.ok(!transcriptNamesPath(undefined, '/tmp/a.log'));
});

test('a transcript names a path in prose, in tool locations, input or output', () => {
  const prose = [log({ text: 'I wrote the summary to /tmp/summary.md' })];
  assert.ok(transcriptNamesPath(prose, '/tmp/summary.md'));

  const located = [
    log({
      type: 'tool_call',
      toolCall: { toolCallId: 't1', name: 'read', status: 'completed', locations: ['/etc/hosts'] }
    })
  ];
  assert.ok(transcriptNamesPath(located, '/etc/hosts'));

  const input = [
    log({
      type: 'tool_call',
      toolCall: { toolCallId: 't2', name: 'read', status: 'completed', rawInput: { filePath: '/tmp/in.json' } }
    })
  ];
  assert.ok(transcriptNamesPath(input, '/tmp/in.json'));

  const output = [
    log({
      type: 'tool_call',
      toolCall: { toolCallId: 't3', name: 'bash', status: 'completed', output: 'created /tmp/out.txt' }
    })
  ];
  assert.ok(transcriptNamesPath(output, '/tmp/out.txt'));

  assert.ok(!transcriptNamesPath([...prose, ...located], '/tmp/never-mentioned.md'));
});

test('only absolute paths can be named', () => {
  assert.ok(!transcriptNamesPath([log({ text: 'src/a.ts' })], 'src/a.ts'));
});
