import test from 'node:test';
import assert from 'node:assert';
import {
  groupTaskSessions,
  sessionDisplayTitle,
  sessionRoleLabel,
  shouldAutoExpandSubagents,
  subagentSummary
} from '../../../shared/task/sessionSidebar.js';
import { TaskSessionView } from '../../../shared/task/sessions.js';
import { SubagentSession } from '../../../shared/sessions/types.js';

function makeSession(overrides: Partial<TaskSessionView>): TaskSessionView {
  return {
    sessionId: 'ses_1',
    title: 'Workout feature edit issues',
    kind: 'main',
    origin: 'initial',
    createdAt: 1000,
    isPrimary: false,
    isActive: false,
    runState: 'idle',
    ...overrides
  };
}

function makeSubagent(overrides: Partial<SubagentSession>): SubagentSession {
  return {
    sessionId: 'sub_1',
    parentId: 'ses_1',
    title: 'Check files (@research subagent)',
    agent: 'research',
    children: [],
    ...overrides
  };
}

test('sessionDisplayTitle avoids repeating the task title when a distinguishing prompt exists', () => {
  const sameAsTask = makeSession({
    title: 'Workout feature edit issues',
    lastUserMessage: 'address pr comment and push'
  });
  assert.strictEqual(
    sessionDisplayTitle(sameAsTask, 'Workout feature edit issues'),
    'address pr comment and push'
  );

  const customFork = makeSession({
    title: 'Try non-nullable cubit',
    lastUserMessage: 'something else'
  });
  assert.strictEqual(
    sessionDisplayTitle(customFork, 'Workout feature edit issues'),
    'Try non-nullable cubit'
  );

  const placeholder = makeSession({
    title: 'New session',
    prompt: 'Investigate flaky workout test'
  });
  assert.strictEqual(
    sessionDisplayTitle(placeholder, 'Workout feature edit issues'),
    'Investigate flaky workout test'
  );
});

test('sessionRoleLabel reflects live state, main thread, fork point, and archived runs', () => {
  assert.strictEqual(sessionRoleLabel(makeSession({ isPrimary: true })), 'Main thread');
  assert.strictEqual(
    sessionRoleLabel(makeSession({ isPrimary: true, runState: 'running' })),
    'Running · Main'
  );
  assert.strictEqual(
    sessionRoleLabel(makeSession({ runState: 'awaiting_input' })),
    'Waiting for you'
  );
  assert.strictEqual(
    sessionRoleLabel(makeSession({ kind: 'btw', origin: 'fork', forkedAtLabel: 'turn #3' })),
    'Fork · turn #3'
  );
  assert.strictEqual(
    sessionRoleLabel(makeSession({ archivedAt: 2000 })),
    'Archived'
  );
});

test('groupTaskSessions nests live forks under their live parent and separates archived runs', () => {
  const main = makeSession({ sessionId: 'main', isPrimary: true, updatedAt: 500 });
  const forkA = makeSession({
    sessionId: 'forkA',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'main',
    updatedAt: 600
  });
  const forkOfArchived = makeSession({
    sessionId: 'forkOrphan',
    kind: 'btw',
    origin: 'fork',
    forkedFrom: 'old1',
    updatedAt: 550
  });
  const archived = makeSession({ sessionId: 'old1', archivedAt: 300, updatedAt: 300 });
  const archivedNewer = makeSession({ sessionId: 'old2', archivedAt: 400, updatedAt: 400 });

  const grouped = groupTaskSessions([archived, forkA, forkOfArchived, main, archivedNewer]);

  assert.deepStrictEqual(
    grouped.live.map((entry) => [entry.session.sessionId, entry.isBranch]),
    [
      ['main', false],
      ['forkA', true],
      ['forkOrphan', false]
    ]
  );
  assert.deepStrictEqual(
    grouped.archived.map((s) => s.sessionId),
    ['old2', 'old1']
  );
});

test('subagentSummary rolls up nested count, running count, and cost', () => {
  const tree = [
    makeSubagent({
      sessionId: 'sub_a',
      cost: 0.31,
      treeCost: 0.51,
      children: [makeSubagent({ sessionId: 'sub_a1', parentId: 'sub_a', cost: 0.2, running: true })]
    }),
    makeSubagent({ sessionId: 'sub_b', cost: 0.49 })
  ];
  const summary = subagentSummary(tree);
  assert.strictEqual(summary.count, 3);
  assert.strictEqual(summary.running, 1);
  assert.ok(Math.abs(summary.totalCost - 1.0) < 1e-9);
});

test('shouldAutoExpandSubagents stays collapsed for finished trees unless open or running', () => {
  const finished = [makeSubagent({ sessionId: 'sub_done' })];
  assert.strictEqual(shouldAutoExpandSubagents(finished, 'ses_1'), false);
  assert.strictEqual(shouldAutoExpandSubagents(finished, 'sub_done'), true);

  const running = [makeSubagent({ sessionId: 'sub_live', running: true })];
  assert.strictEqual(shouldAutoExpandSubagents(running, 'ses_1'), true);
});
