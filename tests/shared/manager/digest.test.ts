import test from 'node:test';
import assert from 'node:assert';
import { boardDigest, describeRequest, digestTask, recentTurns, taskDetail } from '../../../shared/manager/digest.js';
import { MANAGER_TASK_ID } from '../../../shared/manager/identity.js';
import { BoardColumn, TaskLogItem } from '../../../shared/types.js';
import { link, permission, question, task } from '../../fixtures/boardTasks.js';

const columns = [{ id: 'execute', title: 'In progress' }] as BoardColumn[];

test('a blocked task leads the digest, then failures, running and resting, newest first', () => {
  const digest = boardDigest([
    task({ id: 'TASK-1', updatedAt: 10 }),
    task({ id: 'TASK-2', runState: 'running', updatedAt: 20 }),
    task({ id: 'TASK-3', runState: 'error', error: 'boom' }),
    task({ id: 'TASK-4', pendingRequest: question }),
    task({ id: 'TASK-5', updatedAt: 30 }),
    task({ id: MANAGER_TASK_ID, runState: 'running' }),
    task({ id: 'TASK-6', archivedAt: 5 })
  ], columns, 100);

  assert.deepStrictEqual(digest.tasks.map((t) => t.id), ['TASK-4', 'TASK-3', 'TASK-2', 'TASK-5', 'TASK-1']);
  assert.deepStrictEqual(digest.counts, { 'needs-you': 1, failed: 1, running: 1, resting: 2 });
});

test('a request held by a side session still counts as blocked', () => {
  const digest = digestTask(task({
    sessions: [link({ sessionId: 's1' }), link({ sessionId: 's2', kind: 'btw', pendingRequest: permission })]
  }), columns);
  assert.equal(digest.attention, 'needs-you');
  assert.equal(digest.blockedOn, 'permission to run bash: npm test');
  assert.deepStrictEqual(digest.options, ['Allow']);
});

test('a question carries its message and the labels of its choices', () => {
  const described = describeRequest({
    ...question,
    fields: [{
      name: 'branch',
      type: 'string',
      required: true,
      options: [{ value: 'main', label: 'main' }, { value: 'dev', label: 'dev' }]
    }]
  });
  assert.equal(described.blockedOn, 'question: Which branch should I use?');
  assert.deepStrictEqual(described.options, ['main', 'dev']);
});

test('a digest names the column, the project and the linked statuses', () => {
  const digest = digestTask(task({
    projectName: 'web',
    changeSummary: { files: 3, additions: 1, deletions: 1 },
    links: [
      { id: 'l1', url: 'https://x/pr/1', title: 'PR', ref: 'o/r#1', kind: 'pr', source: 'agent', createdAt: 1,
        status: { state: 'merged', label: 'Merged', checkedAt: 1 } },
      { id: 'l2', url: 'https://x/doc', title: 'Doc', kind: 'doc', source: 'user', createdAt: 1 }
    ]
  }), columns);
  assert.equal(digest.column, 'In progress');
  assert.equal(digest.project, 'web');
  assert.equal(digest.changedFiles, 3);
  assert.deepStrictEqual(digest.links, ['o/r#1: Merged']);
});

function log(type: TaskLogItem['type'], text: string, timestamp: number): TaskLogItem {
  return { id: `${type}-${timestamp}`, type, text, timestamp };
}

test('recent turns keep what was said and drop tool calls and thinking', () => {
  const logs = [
    log('user_say', 'fix it', 1),
    log('thought', 'hmm', 2),
    log('tool_call', 'bash', 3),
    log('agent_say', 'fixed', 4),
    log('error', 'tests failed', 5),
    log('user_say', 'again', 6)
  ];
  assert.deepStrictEqual(recentTurns(logs, 3).map((t) => [t.who, t.text]), [
    ['agent', 'fixed'],
    ['error', 'tests failed'],
    ['user', 'again']
  ]);
  assert.deepStrictEqual(recentTurns(undefined, 3), []);
});

test('task detail carries the original request over a rewritten prompt', () => {
  const detail = taskDetail(task({ originalPrompt: 'the real ask', prompt: 'column prompt' }), columns);
  assert.equal(detail.prompt, 'the real ask');
});
