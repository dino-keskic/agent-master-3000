import test from 'node:test';
import assert from 'node:assert';
import {
  awaitingDetail,
  boardDocumentTitle,
  buildNotification,
  coalesceNotifications,
  detectNotificationEvents,
  notifyableRequests
} from '../../../shared/notifications/notifications.js';
import { notificationTag } from '../../../shared/notifications/tags.js';
import { PendingPermission } from '../../../shared/types.js';
import { link, permission, question, task } from '../../fixtures/boardTasks.js';

test('buildNotification names the task and carries the session', () => {
  const note = buildNotification({
    event: 'awaiting_input',
    taskId: 'TASK-9',
    taskTitle: 'Fix the flaky test',
    projectName: 'agent-master-3000',
    sessionId: 'ses_1',
    detail: 'bash · npm test'
  });
  assert.strictEqual(note.title, 'TASK-9 needs your answer');
  assert.match(note.body, /Fix the flaky test/);
  assert.match(note.body, /agent-master-3000/);
  assert.strictEqual(note.taskId, 'TASK-9');
  assert.strictEqual(note.sessionId, 'ses_1');
  assert.strictEqual(note.tag, notificationTag('TASK-9', 'ses_1'));
  assert.notStrictEqual(note.tag, notificationTag('TASK-9', 'ses_other'));
});

test('coalesceNotifications collapses a burst spanning more than three tasks', () => {
  const requests = ['A', 'B', 'C', 'D'].map((id) => ({
    event: 'turn_complete' as const,
    taskId: `TASK-${id}`,
    taskTitle: id
  }));
  const notes = coalesceNotifications(requests);
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0]?.title || '', /4 tasks finished/);
});

test('boardDocumentTitle prefixes a count only when something is waiting', () => {
  assert.strictEqual(boardDocumentTitle(0, 'Agent Master 3000'), 'Agent Master 3000');
  assert.strictEqual(boardDocumentTitle(2, 'Agent Master 3000'), '(2) Agent Master 3000');
});

test('awaitingDetail prefers the command on a permission and the question text', () => {
  assert.strictEqual(awaitingDetail(permission), 'bash · npm test');
  assert.strictEqual(awaitingDetail(question), 'Which branch should I use?');
});

test('detectNotificationEvents', async (t) => {
  await t.test('a first sighting is hydration, not a burst of finished work', () => {
    const next = task({
      sessionId: 'ses_main',
      runState: 'idle',
      sessions: [link({ sessionId: 'ses_main', runState: 'idle' })]
    });
    assert.deepStrictEqual(detectNotificationEvents(undefined, next), []);
  });

  await t.test('running to idle is a finished turn on that session', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running', lastMessage: 'Done.' })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'idle',
      lastMessage: 'Done.',
      sessions: [link({ sessionId: 'ses_main', runState: 'idle', lastMessage: 'Done.' })]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.event, 'turn_complete');
    assert.strictEqual(events[0]?.sessionId, 'ses_main');
    assert.strictEqual(events[0]?.detail, 'Done.');
  });

  await t.test('running to awaiting_input is a needs-you event, not a finish', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.event, 'awaiting_input');
    assert.strictEqual(events[0]?.requestKind, 'permission');
    assert.strictEqual(events[0]?.requestId, 'req-1');
    assert.match(events[0]?.detail || '', /npm test/);
  });

  await t.test('answering (awaiting to running) is not a notification', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    assert.deepStrictEqual(detectNotificationEvents(previous, next), []);
  });

  await t.test('a fork finishing does not hide behind the still-running main', () => {
    const previous = task({
      id: 'TASK-2',
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [
        link({ sessionId: 'ses_main', runState: 'running' }),
        link({ sessionId: 'ses_fork', kind: 'btw', runState: 'running' })
      ]
    });
    const next = task({
      id: 'TASK-2',
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [
        link({ sessionId: 'ses_main', runState: 'running' }),
        link({ sessionId: 'ses_fork', kind: 'btw', runState: 'idle', lastMessage: 'Forked answer' })
      ]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.sessionId, 'ses_fork');
    assert.strictEqual(events[0]?.event, 'turn_complete');
  });

  await t.test('a new session that appears already blocked is a needs-you event', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [
        link({ sessionId: 'ses_main', runState: 'running' }),
        link({ sessionId: 'ses_fork', kind: 'btw', runState: 'awaiting_input', pendingRequest: question })
      ]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.sessionId, 'ses_fork');
    assert.strictEqual(events[0]?.requestKind, 'question');
  });

  await t.test('a new permission on an already-blocked session is a needs-you event', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
    });
    const nextPermission: PendingPermission = { ...permission, requestId: 'req-2', askedAt: 20 };
    const next = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: nextPermission })]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.event, 'awaiting_input');
    assert.strictEqual(events[0]?.requestId, 'req-2');
  });

  await t.test('a task-level permission still notifies when the session link was not updated', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      pendingRequest: permission,
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]?.event, 'awaiting_input');
    assert.strictEqual(events[0]?.requestKind, 'permission');
    assert.strictEqual(events[0]?.requestId, 'req-1');
  });

  await t.test('idle to error fires once', () => {
    const previous = task({
      sessionId: 'ses_main',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_main', runState: 'running' })]
    });
    const next = task({
      sessionId: 'ses_main',
      runState: 'error',
      error: 'Agent crashed',
      sessions: [link({ sessionId: 'ses_main', runState: 'error', error: 'Agent crashed' })]
    });
    const events = detectNotificationEvents(previous, next);
    assert.strictEqual(events[0]?.event, 'error');
    assert.strictEqual(events[0]?.detail, 'Agent crashed');
  });
});

test('notifyableRequests keeps only what the user asked to hear about', () => {
  const requests = [
    { event: 'turn_complete' as const, taskId: 'TASK-1', taskTitle: 'A' },
    { event: 'error' as const, taskId: 'TASK-2', taskTitle: 'B' }
  ];
  assert.strictEqual(notifyableRequests(requests, { enabled: true, error: false }, false).length, 1);
  assert.strictEqual(notifyableRequests(requests, { enabled: true }, true).length, 0);
});

test('notifyableRequests skips the task you are looking at, including asks', () => {
  const requests = [
    { event: 'turn_complete' as const, taskId: 'TASK-1', taskTitle: 'A' },
    { event: 'error' as const, taskId: 'TASK-2', taskTitle: 'B' },
    { event: 'awaiting_input' as const, taskId: 'TASK-1', taskTitle: 'A' }
  ];
  // Focused, so the open panel really is on screen — and notifying at all
  // takes a user who turned the unfocused-only rule off.
  const settings = { enabled: true, onlyWhenUnfocused: false };
  const notifyable = notifyableRequests(requests, settings, true, ['TASK-1']);
  assert.strictEqual(notifyable.length, 1);
  assert.strictEqual(notifyable[0]?.taskId, 'TASK-2');
});

test('a task open in a background window still notifies', () => {
  // Panels persist in the deep link, so the task being worked on is open all
  // day. Away from the board, that is exactly the one worth interrupting for.
  const requests = [
    { event: 'awaiting_input' as const, taskId: 'TASK-1', taskTitle: 'A' },
    { event: 'turn_complete' as const, taskId: 'TASK-2', taskTitle: 'B' }
  ];
  const notifyable = notifyableRequests(requests, { enabled: true }, false, ['TASK-1', 'TASK-2']);
  assert.deepStrictEqual(notifyable.map((request) => request.taskId), ['TASK-1', 'TASK-2']);
});
