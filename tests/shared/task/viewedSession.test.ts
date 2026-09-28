import test from 'node:test';
import assert from 'node:assert';
import {
  resolveViewedSession,
  sessionTabLabel,
  shortSessionLabel,
  transcriptPending
} from '../../../shared/task/viewedSession.js';
import { SubagentSession } from '../../../shared/sessions/types.js';
import { BoardTask, TaskSessionLink } from '../../../shared/types.js';

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
  return { title: 'Session', kind: 'main', createdAt: 1_000, ...overrides };
}

function subagent(overrides: Partial<SubagentSession> & { sessionId: string }): SubagentSession {
  return { parentId: 'ses_main', title: 'Subagent', children: [], ...overrides };
}

const forked = task({
  sessionId: 'ses_main',
  runState: 'running',
  sessions: [
    link({ sessionId: 'ses_main', title: 'Main', runState: 'running' }),
    link({ sessionId: 'ses_fork', title: 'A very long question about the caching layer', kind: 'btw', runState: 'awaiting_input' })
  ]
});

test('the session on screen', async (t) => {
  await t.test('defaults to the task itself when nothing is selected', () => {
    const view = resolveViewedSession(forked, undefined);
    assert.equal(view.viewed, undefined);
    assert.equal(view.isSideSession, false);
    assert.equal(view.isSubagentView, false);
    assert.equal(view.runState, 'running', 'falls back to the task run state');
    assert.equal(view.sessions.length, 2);
  });

  await t.test('a fork reports its own state, and says the main session is busy', () => {
    const view = resolveViewedSession(forked, 'ses_fork');
    assert.equal(view.viewed?.sessionId, 'ses_fork');
    assert.equal(view.isSideSession, true);
    assert.equal(view.runState, 'awaiting_input');
    assert.equal(view.busy, true);
    assert.equal(view.otherBusyCount, 1);
  });

  await t.test('the primary session is not a side session, and counts the fork', () => {
    const view = resolveViewedSession(forked, 'ses_main');
    assert.equal(view.isSideSession, false);
    assert.equal(view.otherBusyCount, 1);
  });

  await t.test('a subagent transcript is read-only history, named by its caller', () => {
    const view = resolveViewedSession(forked, 'ses_sub', {
      ses_main: [subagent({ sessionId: 'ses_sub', agent: 'explore' })]
    });
    assert.equal(view.isSubagentView, true);
    assert.equal(view.subagent?.sessionId, 'ses_sub');
    assert.equal(view.subagentRoot?.sessionId, 'ses_main');
    assert.equal(view.runState, 'idle', 'never inherits the parent session\'s running state');
    assert.equal(view.busy, false);
    assert.equal(view.caller?.sessionId, 'ses_main');
    assert.equal(view.caller?.isRoot, true);
    assert.equal(view.caller?.label, 'Main', 'the root session has no agent, so it is named by title');
  });

  await t.test('a nested subagent is called by the subagent above it', () => {
    const view = resolveViewedSession(forked, 'ses_deep', {
      ses_main: [subagent({
        sessionId: 'ses_sub',
        agent: 'explore',
        children: [subagent({ sessionId: 'ses_deep', parentId: 'ses_sub', agent: 'review' })]
      })]
    });
    assert.equal(view.caller?.sessionId, 'ses_sub');
    assert.equal(view.caller?.isRoot, false);
    assert.equal(view.caller?.label, '@explore');
  });

  await t.test('an id belonging to no session and no tree is still not a linked session', () => {
    const view = resolveViewedSession(forked, 'ses_gone');
    assert.equal(view.isSubagentView, true);
    assert.equal(view.subagent, undefined);
    assert.equal(view.caller, undefined);
    assert.equal(view.runState, 'idle');
  });
});

test('session labels are clipped to something that still identifies them', () => {
  assert.equal(shortSessionLabel(undefined), 'this fork');
  assert.equal(shortSessionLabel('   '), 'this fork');
  assert.equal(shortSessionLabel('Fix  the\nparser'), 'Fix the parser');
  assert.equal(shortSessionLabel('x'.repeat(40)), `${'x'.repeat(32)}…`);
  assert.equal(shortSessionLabel('short enough', 32), 'short enough');
});

test('the session tab says which conversation is on screen', async (t) => {
  const forked = task({
    sessionId: 'ses_main',
    runState: 'running',
    sessions: [
      link({ sessionId: 'ses_main', title: 'Ship the thing', kind: 'main', runState: 'idle' }),
      link({ sessionId: 'ses_fork', title: 'Why is this slow?', kind: 'btw', origin: 'fork', runState: 'running' })
    ]
  });

  await t.test('the task\'s own session needs no qualifier', () => {
    assert.equal(sessionTabLabel(resolveViewedSession(forked, 'ses_main')), 'Session');
  });

  await t.test('a fork is named by where it came from', () => {
    assert.equal(sessionTabLabel(resolveViewedSession(forked, 'ses_fork')), 'Session · Fork');
  });

  await t.test('a subagent is named by the agent that ran it', () => {
    const view = resolveViewedSession(forked, 'ses_sub', {
      ses_main: [subagent({ sessionId: 'ses_sub', agent: 'explore' })]
    });
    assert.equal(sessionTabLabel(view), 'Session · @explore');
  });
});

test('an empty transcript is told apart from one that has not arrived', async (t) => {
  await t.test('a task that carries its own logs is simply empty', () => {
    const plain = task();
    assert.equal(transcriptPending(plain, resolveViewedSession(plain, undefined), undefined), false);
  });

  await t.test('a trimmed transcript is pending until the fetch lands', () => {
    const trimmed = task({ logsOmitted: true });
    const view = resolveViewedSession(trimmed, undefined);
    assert.equal(transcriptPending(trimmed, view, undefined), true);
    assert.equal(transcriptPending(trimmed, view, []), false, 'an empty fetch is still an answer');
  });

  await t.test('logs already on the task win over the trim marker', () => {
    const partial = task({ logsOmitted: true, logs: [{ id: 'l1', type: 'agent_say', text: 'hi', timestamp: 1 }] });
    assert.equal(transcriptPending(partial, resolveViewedSession(partial, undefined), undefined), false);
  });

  await t.test('a subagent transcript is never in the snapshot', () => {
    const withTree = task({ sessionId: 'ses_main', sessions: [link({ sessionId: 'ses_main' })] });
    const view = resolveViewedSession(withTree, 'ses_sub', {
      ses_main: [subagent({ sessionId: 'ses_sub' })]
    });
    assert.equal(transcriptPending(withTree, view, undefined), true);
  });
});
