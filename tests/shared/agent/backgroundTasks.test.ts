import test from 'node:test';
import assert from 'node:assert';
import {
  collectActiveTools,
  executeCommand,
  isExecuteTool,
  listBackgroundTasks,
  processKillSpec,
  slimToolCall,
  toolCallSummary
} from '../../../shared/agent/backgroundTasks.js';
import { BoardTask, TaskLogItem, ToolCallInfo } from '../../../shared/types.js';

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'TASK-1',
    title: 'Ship the thing',
    description: '',
    prompt: 'do it',
    columnId: 'execute',
    runState: 'running',
    model: 'anthropic/claude',
    agent: 'build',
    thinkingLevel: 'default',
    cwd: '/repo',
    createdAt: 1_000,
    updatedAt: 2_000,
    logs: [],
    ...overrides
  };
}

function bash(status: ToolCallInfo['status'], id = 'tc-bash'): ToolCallInfo {
  return {
    toolCallId: id,
    name: 'bash',
    kind: 'execute',
    status,
    rawInput: { command: 'npm test' }
  };
}

function read(status: ToolCallInfo['status'], id = 'tc-read'): ToolCallInfo {
  return {
    toolCallId: id,
    name: 'read',
    kind: 'read',
    status,
    locations: ['/repo/src/App.tsx']
  };
}

function log(info: ToolCallInfo, extra: Partial<TaskLogItem> = {}): TaskLogItem {
  return {
    id: info.toolCallId,
    timestamp: extra.timestamp ?? 50,
    type: 'tool_call',
    text: info.name,
    toolCall: info,
    ...extra
  };
}

test('slimToolCall drops streamed output', () => {
  const slim = slimToolCall({ ...bash('in_progress'), output: 'lots of test output' });
  assert.strictEqual(slim.output, undefined);
  assert.strictEqual(slim.name, 'bash');
});

test('collectActiveTools prefers live logs and fills gaps from the snapshot field', () => {
  const fromSnapshot = collectActiveTools(
    task({
      logsOmitted: true,
      logs: [],
      activeTools: [{ toolCall: bash('in_progress'), sessionId: 'ses_main', startedAt: 10 }]
    })
  );
  assert.strictEqual(fromSnapshot.length, 1);
  assert.strictEqual(fromSnapshot[0]?.toolCall.name, 'bash');

  const completedInLogs = collectActiveTools(
    task({
      logs: [log(bash('completed'))],
      activeTools: [{ toolCall: bash('in_progress'), sessionId: 'ses_main', startedAt: 10 }]
    })
  );
  assert.strictEqual(completedInLogs.length, 0);

  const newInLogs = collectActiveTools(
    task({
      logs: [log(bash('in_progress', 'tc-new'), { timestamp: 90, sessionId: 'ses_fork' })],
      activeTools: [{ toolCall: read('in_progress'), sessionId: 'ses_main', startedAt: 10 }]
    })
  );
  assert.deepStrictEqual(
    newInLogs.map((item) => item.toolCall.toolCallId).sort(),
    ['tc-new', 'tc-read']
  );
});

test('listBackgroundTasks puts execute tools first and skips idle sessions', () => {
  const items = listBackgroundTasks([
    task({
      sessionId: 'ses_main',
      logs: [
        log(read('in_progress'), { timestamp: 80, sessionId: 'ses_main' }),
        log(bash('in_progress'), { timestamp: 20, sessionId: 'ses_main' })
      ],
      sessions: [
        {
          sessionId: 'ses_main',
          title: 'Main',
          kind: 'main',
          createdAt: 1,
          runState: 'running'
        }
      ]
    }),
    task({
      id: 'TASK-stale',
      sessionId: 'ses_done',
      runState: 'idle',
      logs: [log(bash('in_progress', 'tc-stale'), { sessionId: 'ses_done' })],
      sessions: [
        {
          sessionId: 'ses_done',
          title: 'Done',
          kind: 'main',
          createdAt: 1,
          runState: 'idle'
        }
      ]
    })
  ]);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0]?.toolCall.name, 'bash');
  assert.strictEqual(items[1]?.toolCall.name, 'read');
  assert.strictEqual(items[0]?.sessionTitle, 'Main');
  assert.ok(items.every((item) => item.taskId !== 'TASK-stale'));
});

test('toolCallSummary and isExecuteTool', () => {
  assert.strictEqual(isExecuteTool(bash('in_progress')), true);
  assert.strictEqual(isExecuteTool(read('in_progress')), false);
  assert.strictEqual(toolCallSummary(bash('in_progress')), 'npm test');
  assert.strictEqual(
    toolCallSummary({ ...bash('in_progress'), locations: ['/repo/src'] }),
    'npm test'
  );
  assert.strictEqual(toolCallSummary(read('in_progress')), 'src/App.tsx');
  assert.strictEqual(executeCommand(bash('in_progress')), 'npm test');
});

test('processKillSpec keeps completed bash commands so a backgrounded shell can still be found', () => {
  const spec = processKillSpec(
    task({
      cwd: '/repo',
      sessionId: 'ses_main',
      logs: [
        log(bash('completed', 'tc-bg'), { sessionId: 'ses_main' }),
        log(read('completed'), { sessionId: 'ses_main' }),
        log(
          { ...bash('in_progress', 'tc-fork'), rawInput: { command: 'npm run dev' } },
          { sessionId: 'ses_fork' }
        )
      ],
      sessions: [
        { sessionId: 'ses_main', title: 'Main', kind: 'main', createdAt: 1, cwd: '/repo' },
        { sessionId: 'ses_fork', title: 'Fork', kind: 'btw', createdAt: 2, cwd: '/repo/worktree' }
      ]
    })
  );
  assert.deepStrictEqual(spec.commands.sort(), ['npm run dev', 'npm test']);
  assert.deepStrictEqual(spec.cwds.sort(), ['/repo', '/repo/worktree']);

  const forkOnly = processKillSpec(
    task({
      cwd: '/repo',
      logs: [
        log(bash('completed'), { sessionId: 'ses_main' }),
        log(
          { ...bash('in_progress', 'tc-fork'), rawInput: { command: 'npm run dev' } },
          { sessionId: 'ses_fork' }
        )
      ],
      sessions: [
        { sessionId: 'ses_main', title: 'Main', kind: 'main', createdAt: 1, cwd: '/repo' },
        { sessionId: 'ses_fork', title: 'Fork', kind: 'btw', createdAt: 2, cwd: '/repo/worktree' }
      ]
    }),
    ['ses_fork']
  );
  assert.deepStrictEqual(forkOnly.commands, ['npm run dev']);
  assert.deepStrictEqual(forkOnly.cwds, ['/repo/worktree']);
});
