import test from 'node:test';
import assert from 'node:assert';
import { STALE_TOOL_MESSAGE, staleToolLogIds, sweepStaleTools, taskIsWorking } from '../../../shared/agent/staleTools.js';
import { BoardTask, TaskLogItem, TaskRunState, TaskSessionLink, ToolCallInfo } from '../../../shared/types.js';

/** Which in-flight tool calls nothing is left to finish. */

function toolLog(
  id: string,
  status: ToolCallInfo['status'],
  sessionId?: string
): TaskLogItem {
  return {
    id,
    timestamp: 1,
    type: 'tool_call',
    title: 'grep',
    text: '',
    sessionId,
    toolCall: { toolCallId: id, name: 'grep', kind: 'search', status, rawInput: {} }
  };
}

function task(patch: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'TASK-1',
    title: 'TASK-1',
    description: '',
    prompt: 'p',
    columnId: 'backlog',
    runState: 'idle',
    model: 'm',
    agent: 'a',
    thinkingLevel: 'default',
    cwd: '/tmp',
    sessionId: 'ses_main',
    createdAt: 1,
    updatedAt: 1,
    logs: [],
    ...patch
  };
}

function link(sessionId: string, runState: TaskRunState): TaskSessionLink {
  return { sessionId, title: sessionId, kind: 'main', createdAt: 1, runState };
}

test('an idle task keeps no live tool calls: nothing is left to report them', () => {
  const stuck = task({ logs: [toolLog('grep_1', 'in_progress', 'ses_main')] });
  assert.deepStrictEqual(staleToolLogIds(stuck), ['grep_1']);
});

test('a running session owns its in-flight tools', () => {
  const busy = task({
    runState: 'running',
    sessions: [link('ses_main', 'running')],
    logs: [toolLog('grep_1', 'in_progress', 'ses_main')]
  });
  assert.deepStrictEqual(staleToolLogIds(busy), []);
});

test('a session waiting on the operator is still working', () => {
  const waiting = task({
    runState: 'awaiting_input',
    sessions: [link('ses_main', 'awaiting_input')],
    logs: [toolLog('bash_1', 'pending', 'ses_main')]
  });
  assert.deepStrictEqual(staleToolLogIds(waiting), []);
});

test('one resting session does not take down another that is running', () => {
  const mixed = task({
    runState: 'running',
    sessions: [link('ses_main', 'running'), link('ses_fork', 'idle')],
    logs: [
      toolLog('grep_1', 'in_progress', 'ses_main'),
      toolLog('grep_2', 'in_progress', 'ses_fork')
    ]
  });
  assert.deepStrictEqual(staleToolLogIds(mixed), ['grep_2']);
});

test("a subagent's tool survives while the task it belongs to still works", () => {
  const parent = task({
    runState: 'running',
    sessions: [link('ses_main', 'running')],
    logs: [toolLog('read_1', 'in_progress', 'ses_child')]
  });
  assert.deepStrictEqual(staleToolLogIds(parent), []);
});

test('a subagent tool is stale once nothing on the task is working', () => {
  const done = task({ logs: [toolLog('read_1', 'in_progress', 'ses_child')] });
  assert.deepStrictEqual(staleToolLogIds(done), ['read_1']);
});

test('a tool call with no session belongs to the task as a whole', () => {
  const running = task({
    runState: 'running',
    sessions: [link('ses_main', 'running')],
    logs: [toolLog('glob_1', 'in_progress')]
  });
  assert.deepStrictEqual(staleToolLogIds(running), []);
  assert.deepStrictEqual(staleToolLogIds(task({ logs: [toolLog('glob_1', 'in_progress')] })), ['glob_1']);
});

test('settled tool calls are left exactly as they are', () => {
  const settled = task({
    logs: [toolLog('grep_1', 'completed', 'ses_main'), toolLog('grep_2', 'failed', 'ses_main')]
  });
  assert.deepStrictEqual(staleToolLogIds(settled), []);
  assert.deepStrictEqual(sweepStaleTools(settled).changed, []);
});

test('the sweep fails the stale rows and returns only those', () => {
  const stuck = task({
    logs: [toolLog('grep_1', 'in_progress', 'ses_main'), toolLog('grep_2', 'completed', 'ses_main')]
  });
  const { logs, changed } = sweepStaleTools(stuck);
  assert.strictEqual(changed.length, 1);
  assert.strictEqual(changed[0]!.id, 'grep_1');
  assert.strictEqual(changed[0]!.toolCall!.status, 'failed');
  assert.strictEqual(changed[0]!.toolCall!.output, STALE_TOOL_MESSAGE);
  assert.strictEqual(logs[0]!.toolCall!.status, 'failed');
  assert.strictEqual(logs[1]!.toolCall!.status, 'completed');
});

test('output the tool did produce stands instead of the generic message', () => {
  const partial = task({ logs: [toolLog('bash_1', 'in_progress', 'ses_main')] });
  partial.logs[0]!.toolCall!.output = 'half a build log';
  const { changed } = sweepStaleTools(partial);
  assert.strictEqual(changed[0]!.toolCall!.output, 'half a build log');
});

test('nothing to sweep leaves the logs array untouched', () => {
  const clean = task({ logs: [toolLog('grep_1', 'completed', 'ses_main')] });
  assert.strictEqual(sweepStaleTools(clean).logs, clean.logs);
});

test('taskIsWorking reads the sessions, not only the task', () => {
  assert.strictEqual(taskIsWorking(task()), false);
  assert.strictEqual(taskIsWorking(task({ sessions: [link('ses_fork', 'running')] })), true);
  assert.strictEqual(taskIsWorking(task({ runState: 'running' })), true);
});
