import test from 'node:test';
import assert from 'node:assert';
import {
  activeSessionIdFor,
  activityCounts,
  aggregateRunState,
  boardSessionActivity,
  busySessionCount,
  isSessionBusy,
  listTaskSessions,
  liveTaskSessions,
  sessionChoiceOf,
  settingsTargetFor,
  sessionCwd,
  sessionOriginLabel,
  sessionPendingRequest,
  sessionRunSettings,
  sessionRunState,
  taskSessionViews
} from '../../../shared/task/sessions.js';
import { BoardTask, PendingPermission, TaskSessionLink } from '../../../shared/types.js';

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: 'TASK-1',
    title: 'Ship the thing',
    description: '',
    prompt: 'do it',
    columnId: 'execute',
    runState: 'idle',
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

function link(overrides: Partial<TaskSessionLink> & { sessionId: string }): TaskSessionLink {
  return {
    title: 'Session',
    kind: 'main',
    createdAt: 1_000,
    ...overrides
  };
}

test('Task session model', async (t) => {
  await t.test('a task with only sessionId still lists one main session', () => {
    const sessions = listTaskSessions(task({ sessionId: 'ses_main' }));
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0]?.sessionId, 'ses_main');
    assert.strictEqual(sessions[0]?.kind, 'main');
    assert.strictEqual(sessions[0]?.origin, 'initial');
  });

  await t.test('a task-level permission is overlaid onto the primary session', () => {
    const pending: PendingPermission = {
      type: 'permission',
      requestId: 'req-1',
      askedAt: 10,
      toolCall: { toolCallId: 'tc-1', name: 'bash', status: 'pending' },
      options: []
    };
    const sessions = listTaskSessions(
      task({
        sessionId: 'ses_main',
        pendingRequest: pending,
        sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
      })
    );
    assert.strictEqual(sessions[0]?.pendingRequest?.requestId, 'req-1');
    assert.strictEqual(
      sessionRunState(
        task({ sessionId: 'ses_main', pendingRequest: pending, runState: 'awaiting_input' }),
        sessions[0]
      ),
      'awaiting_input'
    );
    assert.strictEqual(
      sessionPendingRequest(
        task({ sessionId: 'ses_main', pendingRequest: pending }),
        sessions[0]
      )?.requestId,
      'req-1'
    );
  });

  await t.test('a fork permission is not copied onto the primary session', () => {
    const pending: PendingPermission = {
      type: 'permission',
      requestId: 'req-fork',
      askedAt: 10,
      toolCall: { toolCallId: 'tc-1', name: 'bash', status: 'pending' },
      options: []
    };
    const board = task({
      sessionId: 'ses_main',
      pendingRequest: pending,
      runState: 'awaiting_input',
      sessions: [
        link({ sessionId: 'ses_main', kind: 'main', runState: 'running' }),
        link({ sessionId: 'ses_fork', kind: 'btw', runState: 'awaiting_input', pendingRequest: pending })
      ]
    });
    const sessions = listTaskSessions(board);
    const main = sessions.find((s) => s.sessionId === 'ses_main');
    const fork = sessions.find((s) => s.sessionId === 'ses_fork');
    assert.strictEqual(main?.pendingRequest, undefined);
    assert.strictEqual(fork?.pendingRequest?.requestId, 'req-fork');
    assert.strictEqual(sessionRunState(board, main!), 'running');
    assert.strictEqual(sessionRunState(board, fork), 'awaiting_input');
  });

  await t.test('a linked session wins over the synthesized one', () => {
    const sessions = listTaskSessions(
      task({
        sessionId: 'ses_main',
        sessions: [link({ sessionId: 'ses_main', title: 'Renamed', kind: 'main' })]
      })
    );
    assert.strictEqual(sessions.length, 1);
    assert.strictEqual(sessions[0]?.title, 'Renamed');
  });

  await t.test('main sorts first, archived last, forks by recency', () => {
    const sessions = listTaskSessions(
      task({
        sessionId: 'ses_main',
        sessions: [
          link({ sessionId: 'ses_old', kind: 'stage', archivedAt: 50, updatedAt: 50 }),
          link({ sessionId: 'ses_fork_a', kind: 'btw', updatedAt: 100 }),
          link({ sessionId: 'ses_fork_b', kind: 'btw', updatedAt: 300 }),
          link({ sessionId: 'ses_main', kind: 'main', updatedAt: 200 })
        ]
      })
    );
    assert.deepStrictEqual(
      sessions.map((s) => s.sessionId),
      ['ses_main', 'ses_fork_b', 'ses_fork_a', 'ses_old']
    );
  });

  await t.test('run state falls back to the task only for the primary session', () => {
    const base = task({ sessionId: 'ses_main', runState: 'running' });
    assert.strictEqual(sessionRunState(base, { sessionId: 'ses_main' }), 'running');
    // A fork with no recorded state is idle, not "whatever the task is doing" —
    // otherwise every fork inherits a running badge it never earned.
    assert.strictEqual(sessionRunState(base, { sessionId: 'ses_fork' }), 'idle');
    assert.strictEqual(sessionRunState(base, { sessionId: 'ses_fork', runState: 'error' }), 'error');
  });

  await t.test('aggregate ranks a blocked session above a running one', () => {
    assert.strictEqual(
      aggregateRunState([
        link({ sessionId: 'a', runState: 'running' }),
        link({ sessionId: 'b', runState: 'awaiting_input' })
      ]),
      'awaiting_input'
    );
    assert.strictEqual(
      aggregateRunState([link({ sessionId: 'a', runState: 'idle' }), link({ sessionId: 'b', runState: 'running' })]),
      'running'
    );
    assert.strictEqual(
      aggregateRunState([link({ sessionId: 'a', runState: 'error' }), link({ sessionId: 'b', runState: 'idle' })]),
      'error'
    );
  });

  await t.test('an archived session stops counting as work in progress', () => {
    // A stage transition retires the session it moved on from. Whatever run
    // state the link happened to be carrying is history: nothing polls an
    // archived session, so a card left running here stays running forever.
    const retired = link({ sessionId: 'ses_old', kind: 'stage', runState: 'running', archivedAt: 500 });
    const board = task({ sessionId: 'ses_new', sessions: [retired, link({ sessionId: 'ses_new', runState: 'idle' })] });

    assert.strictEqual(sessionRunState(board, retired), 'idle');
    assert.strictEqual(aggregateRunState([retired]), 'idle');
    assert.strictEqual(aggregateRunState([retired], 'idle'), 'idle');
    assert.strictEqual(busySessionCount(board), 0);
    assert.strictEqual(liveTaskSessions(board).length, 1);
    assert.strictEqual(liveTaskSessions(board)[0]?.sessionId, 'ses_new');
    // A live session next to it is still counted.
    assert.strictEqual(
      aggregateRunState([retired, link({ sessionId: 'ses_new', runState: 'running' })]),
      'running'
    );
  });

  await t.test('aggregate uses the fallback when no session has a state', () => {
    assert.strictEqual(aggregateRunState([link({ sessionId: 'a' })], 'running'), 'running');
    assert.strictEqual(aggregateRunState([], 'idle'), 'idle');
  });

  await t.test('sessionCwd uses the link folder when it differs from the task', () => {
    const board = task({ cwd: '/repo' });
    assert.strictEqual(sessionCwd(board), '/repo');
    assert.strictEqual(sessionCwd(board, { cwd: '/other' }), '/other');
    assert.strictEqual(sessionCwd(board, { cwd: undefined }), '/repo');
  });

  await t.test('the active session is the pick, then the primary, then the first', () => {
    const withPick = task({
      sessionId: 'ses_main',
      activeSessionId: 'ses_fork',
      sessions: [link({ sessionId: 'ses_fork', kind: 'btw' })]
    });
    assert.strictEqual(activeSessionIdFor(withPick), 'ses_fork');

    // A pick pointing at a session that is no longer linked must not stick.
    const stalePick = task({ sessionId: 'ses_main', activeSessionId: 'ses_gone' });
    assert.strictEqual(activeSessionIdFor(stalePick), 'ses_main');

    // After a stage transition the task has no primary session at all.
    const archivedOnly = task({ sessions: [link({ sessionId: 'ses_stage', kind: 'stage', archivedAt: 10 })] });
    assert.strictEqual(activeSessionIdFor(archivedOnly), 'ses_stage');
  });

  await t.test('views mark the primary and the one on screen', () => {
    const views = taskSessionViews(
      task({
        sessionId: 'ses_main',
        activeSessionId: 'ses_fork',
        runState: 'running',
        sessions: [
          link({ sessionId: 'ses_main', kind: 'main', runState: 'running' }),
          link({ sessionId: 'ses_fork', kind: 'btw', runState: 'awaiting_input' })
        ]
      })
    );
    const main = views.find((v) => v.sessionId === 'ses_main');
    const fork = views.find((v) => v.sessionId === 'ses_fork');
    assert.strictEqual(main?.isPrimary, true);
    assert.strictEqual(main?.isActive, false);
    assert.strictEqual(fork?.isPrimary, false);
    assert.strictEqual(fork?.isActive, true);
  });

  await t.test('busy counts both running and blocked sessions', () => {
    assert.strictEqual(isSessionBusy('running'), true);
    assert.strictEqual(isSessionBusy('awaiting_input'), true);
    assert.strictEqual(isSessionBusy('idle'), false);
    assert.strictEqual(isSessionBusy(undefined), false);

    const counted = task({
      sessionId: 'ses_main',
      sessions: [
        link({ sessionId: 'ses_main', runState: 'running' }),
        link({ sessionId: 'ses_fork', kind: 'btw', runState: 'awaiting_input' }),
        link({ sessionId: 'ses_done', kind: 'btw', runState: 'idle' })
      ]
    });
    assert.strictEqual(busySessionCount(counted), 2);
  });

  await t.test('board activity flattens every session and triages blocked first', () => {
    const items = boardSessionActivity([
      task({
        id: 'TASK-1',
        sessionId: 'ses_a',
        sessions: [
          link({ sessionId: 'ses_a', runState: 'running', updatedAt: 10 }),
          link({ sessionId: 'ses_a_fork', kind: 'btw', runState: 'idle', updatedAt: 90 })
        ]
      }),
      task({
        id: 'TASK-2',
        sessionId: 'ses_b',
        sessions: [link({ sessionId: 'ses_b', runState: 'awaiting_input', updatedAt: 5 })]
      })
    ]);

    assert.deepStrictEqual(
      items.map((item) => item.session.sessionId),
      ['ses_b', 'ses_a', 'ses_a_fork']
    );
    assert.strictEqual(items[0]?.taskId, 'TASK-2');

    const counts = activityCounts(items);
    assert.deepStrictEqual(counts, { awaiting: 1, running: 1, error: 0, idle: 1, total: 3 });
  });

  await t.test('origin labels name what the session is', () => {
    assert.strictEqual(sessionOriginLabel({ kind: 'btw' }), 'Fork');
    assert.strictEqual(sessionOriginLabel({ kind: 'stage' }), 'Stage');
    assert.strictEqual(sessionOriginLabel({ kind: 'main', origin: 'new' }), 'New');
    assert.strictEqual(sessionOriginLabel({ kind: 'main', origin: 'initial' }), 'Main');
  });
});

test('a session runs as its own pick, and as the task only without one', async (t) => {
  const settings = { model: 'kimi', agent: 'CEO', thinkingLevel: 'high' };

  await t.test('no pick of its own is the task\'s settings', () => {
    assert.deepStrictEqual(sessionRunSettings(settings, undefined), settings);
    assert.deepStrictEqual(sessionRunSettings(settings, {}), settings);
  });

  await t.test('a fork started on another model keeps it', () => {
    assert.deepStrictEqual(sessionRunSettings(settings, { model: 'astra' }), {
      model: 'astra',
      agent: 'CEO',
      thinkingLevel: 'high'
    });
  });

  await t.test('only what was picked departs; the rest still follows the task', () => {
    const chosen = { agent: 'reviewer' };
    assert.deepStrictEqual(sessionRunSettings(settings, chosen).model, 'kimi');
    assert.deepStrictEqual(sessionRunSettings(settings, chosen).agent, 'reviewer');
  });

  await t.test('a pick matching the task is not recorded', () => {
    assert.strictEqual(sessionChoiceOf(settings, { model: 'kimi', agent: 'CEO' }), undefined);
    assert.strictEqual(sessionChoiceOf(settings, undefined), undefined);
  });

  await t.test('a pick that departs records only the departure', () => {
    assert.deepStrictEqual(
      sessionChoiceOf(settings, { model: 'astra', agent: 'CEO', thinkingLevel: 'high' }),
      { model: 'astra' }
    );
  });
});

test('a setting changed in a side chat stays in that side chat', () => {
  const task = { sessionId: 'ses_main' };
  assert.strictEqual(settingsTargetFor(task, 'ses_main'), 'task', "the task's own conversation is the task");
  assert.strictEqual(settingsTargetFor(task, undefined), 'task', 'and so is the composer with nothing on screen');
  assert.strictEqual(settingsTargetFor(task, 'ses_fork'), 'session');
});
