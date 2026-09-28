import test from 'node:test';
import assert from 'node:assert';
import {
  BoardNotification,
  MAX_INBOX_NOTIFICATIONS,
  dismissNotification,
  inboxItemFromRequest,
  isLiveAwaiting,
  livePendingRequest,
  markAllNotificationsRead,
  markNotificationRead,
  markSessionNotificationsRead,
  mergeInbox,
  pruneInbox,
  seedAwaitingNotifications,
  unreadCount
} from '../../../shared/notifications/inbox.js';
import { sessionInboxKey } from '../../../shared/notifications/tags.js';
import { link, permission, task } from '../../fixtures/boardTasks.js';

test('inbox merge keeps one row per session and caps the list', () => {
  const first = inboxItemFromRequest(
    {
      event: 'awaiting_input',
      taskId: 'TASK-1',
      taskTitle: 'Ship',
      sessionId: 'ses_main',
      requestId: 'req-1'
    },
    100
  );
  const read = markNotificationRead([first], first.id);
  const again = inboxItemFromRequest(
    {
      event: 'awaiting_input',
      taskId: 'TASK-1',
      taskTitle: 'Ship v2',
      sessionId: 'ses_main',
      requestId: 'req-1',
      detail: 'bash · npm test'
    },
    200
  );
  const merged = mergeInbox(read, [again]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0]?.read, true);
  assert.strictEqual(merged[0]?.createdAt, 100);
  assert.strictEqual(merged[0]?.taskTitle, 'Ship v2');
  assert.strictEqual(merged[0]?.detail, 'bash · npm test');
  assert.strictEqual(unreadCount(merged), 0);

  const burst: BoardNotification[] = [];
  for (let i = 0; i < MAX_INBOX_NOTIFICATIONS + 5; i++) {
    burst.push(
      inboxItemFromRequest(
        { event: 'turn_complete', taskId: `TASK-${i}`, taskTitle: `T${i}`, sessionId: `ses_${i}` },
        i
      )
    );
  }
  const capped = mergeInbox([], burst);
  assert.strictEqual(capped.length, MAX_INBOX_NOTIFICATIONS);
  assert.strictEqual(capped[0]?.taskId, `TASK-${MAX_INBOX_NOTIFICATIONS + 4}`);

  const laterAsk = inboxItemFromRequest(
    {
      event: 'awaiting_input',
      taskId: 'TASK-1',
      taskTitle: 'Ship v3',
      sessionId: 'ses_main',
      requestId: 'req-2',
      requestKind: 'permission',
      detail: 'bash · rm -rf'
    },
    300
  );
  const replaced = mergeInbox(merged, [laterAsk]);
  assert.strictEqual(replaced.length, 1);
  assert.strictEqual(replaced[0]?.requestId, 'req-2');
  assert.strictEqual(replaced[0]?.createdAt, 300);
  assert.strictEqual(replaced[0]?.read, false);
  assert.strictEqual(replaced[0]?.id, sessionInboxKey('TASK-1', 'ses_main'));

  const finished = inboxItemFromRequest(
    { event: 'turn_complete', taskId: 'TASK-1', taskTitle: 'Ship', sessionId: 'ses_main' },
    400
  );
  const afterFinish = mergeInbox(replaced, [finished]);
  assert.strictEqual(afterFinish.length, 1);
  assert.strictEqual(afterFinish[0]?.event, 'turn_complete');

  const fork = inboxItemFromRequest(
    { event: 'awaiting_input', taskId: 'TASK-1', taskTitle: 'Ship', sessionId: 'ses_fork', requestId: 'req-fork' },
    500
  );
  const twoSessions = mergeInbox(afterFinish, [fork]);
  assert.strictEqual(twoSessions.length, 2);

  const stacked = mergeInbox(
    [
      inboxItemFromRequest(
        { event: 'turn_complete', taskId: 'TASK-9', taskTitle: 'Old', sessionId: 'ses_main' },
        10
      ),
      inboxItemFromRequest(
        { event: 'error', taskId: 'TASK-9', taskTitle: 'Newer', sessionId: 'ses_main' },
        20
      )
    ],
    []
  );
  assert.strictEqual(stacked.length, 1);
  assert.strictEqual(stacked[0]?.event, 'error');
});

test('seedAwaitingNotifications lists currently blocked sessions', () => {
  const seeded = seedAwaitingNotifications([
    task({
      sessionId: 'ses_main',
      runState: 'awaiting_input',
      sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
    }),
    task({
      id: 'TASK-2',
      sessionId: 'ses_ok',
      runState: 'running',
      sessions: [link({ sessionId: 'ses_ok', runState: 'running' })]
    })
  ]);
  assert.strictEqual(seeded.length, 1);
  assert.strictEqual(seeded[0]?.taskId, 'TASK-1');
  assert.strictEqual(seeded[0]?.event, 'awaiting_input');
});

test('isLiveAwaiting follows the session, not the leftover inbox row', () => {
  const item = inboxItemFromRequest({
    event: 'awaiting_input',
    taskId: 'TASK-1',
    taskTitle: 'Ship',
    sessionId: 'ses_main',
    requestId: 'req-1'
  });
  const blocked = task({
    sessionId: 'ses_main',
    runState: 'awaiting_input',
    sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
  });
  const idle = task({
    sessionId: 'ses_main',
    runState: 'idle',
    sessions: [link({ sessionId: 'ses_main', runState: 'idle' })]
  });
  assert.strictEqual(isLiveAwaiting(item, [blocked]), true);
  assert.strictEqual(isLiveAwaiting(item, [idle]), false);

  // The panel offers Allow/Reject on the row, so it needs the request itself.
  assert.strictEqual(livePendingRequest(item, [blocked])?.requestId, 'req-1');
  assert.strictEqual(livePendingRequest(item, [idle]), undefined);
  assert.strictEqual(livePendingRequest(item, []), undefined);
});


test('marking read and dismissing', () => {
  const a = inboxItemFromRequest({ event: 'turn_complete', taskId: 'TASK-1', taskTitle: 'A' }, 1);
  const b = inboxItemFromRequest({ event: 'error', taskId: 'TASK-2', taskTitle: 'B' }, 2);
  const inbox = [a, b];
  assert.strictEqual(unreadCount(markAllNotificationsRead(inbox)), 0);
  assert.deepStrictEqual(dismissNotification(inbox, a.id).map((item) => item.id), [b.id]);
});

test('pruneInbox drops what the open task has already shown you', () => {
  const finished = inboxItemFromRequest(
    { event: 'turn_complete', taskId: 'TASK-1', taskTitle: 'Ship', sessionId: 'ses_main' },
    1
  );
  const failed = inboxItemFromRequest(
    { event: 'error', taskId: 'TASK-1', taskTitle: 'Ship', sessionId: 'ses_fork' },
    2
  );
  const other = inboxItemFromRequest(
    { event: 'turn_complete', taskId: 'TASK-2', taskTitle: 'Other', sessionId: 'ses_other' },
    3
  );
  const inbox = [finished, failed, other];
  const pruned = pruneInbox(inbox, [], ['TASK-1']);
  assert.deepStrictEqual(pruned.map((item) => item.id), [other.id]);
  assert.strictEqual(pruneInbox(pruned, [], ['TASK-1']), pruned);
});

test('pruneInbox keeps a live ask on the open task until it is answered', () => {
  const ask = inboxItemFromRequest({
    event: 'awaiting_input',
    taskId: 'TASK-1',
    taskTitle: 'Ship',
    sessionId: 'ses_main',
    requestId: 'req-1'
  });
  const finished = inboxItemFromRequest(
    { event: 'turn_complete', taskId: 'TASK-1', taskTitle: 'Ship', sessionId: 'ses_fork' },
    2
  );
  const blocked = task({
    sessionId: 'ses_main',
    runState: 'awaiting_input',
    sessions: [link({ sessionId: 'ses_main', runState: 'awaiting_input', pendingRequest: permission })]
  });
  const pruned = pruneInbox([ask, finished], [blocked], ['TASK-1']);
  assert.strictEqual(pruned.length, 1);
  assert.strictEqual(pruned[0]?.id, ask.id);
  assert.strictEqual(pruned[0]?.read, false);

  const idle = task({
    sessionId: 'ses_main',
    runState: 'idle',
    sessions: [link({ sessionId: 'ses_main', runState: 'idle' })]
  });
  assert.deepStrictEqual(pruneInbox(pruned, [idle], ['TASK-1']), []);
});

test('pruneInbox drops an answered ask even when the task is not open', () => {
  const ask = inboxItemFromRequest({
    event: 'awaiting_input',
    taskId: 'TASK-1',
    taskTitle: 'Ship',
    sessionId: 'ses_main',
    requestId: 'req-1'
  });
  const idle = task({
    sessionId: 'ses_main',
    runState: 'idle',
    sessions: [link({ sessionId: 'ses_main', runState: 'idle' })]
  });
  assert.deepStrictEqual(pruneInbox([ask], [idle], []), []);
});

test('pruneInbox keeps an ask whose task has not loaded yet', () => {
  const ask = inboxItemFromRequest({
    event: 'awaiting_input',
    taskId: 'TASK-1',
    taskTitle: 'Ship',
    sessionId: 'ses_main',
    requestId: 'req-1'
  });
  const inbox = [ask];
  assert.strictEqual(pruneInbox(inbox, [], []), inbox);
});

test('opening a session marks what that click answered as read', async (t) => {
  const main = inboxItemFromRequest(
    { event: 'awaiting_input', taskId: 'TASK-1', taskTitle: 'A', sessionId: 'ses_main' },
    1
  );
  const fork = inboxItemFromRequest(
    { event: 'awaiting_input', taskId: 'TASK-1', taskTitle: 'A', sessionId: 'ses_fork' },
    2
  );
  const whole = inboxItemFromRequest({ event: 'turn_complete', taskId: 'TASK-1', taskTitle: 'A' }, 3);
  const other = inboxItemFromRequest({ event: 'error', taskId: 'TASK-2', taskTitle: 'B' }, 4);
  const inbox = [main, fork, whole, other];

  await t.test('the named session, and the rows about the task itself', () => {
    const read = markSessionNotificationsRead(inbox, 'TASK-1', 'ses_fork');
    const byId = new Map(read.map((item) => [item.id, item.read]));
    assert.strictEqual(byId.get(fork.id), true);
    assert.strictEqual(byId.get(whole.id), true);
    assert.strictEqual(byId.get(main.id), false);
  });

  await t.test('every row of the task when no session was named', () => {
    const read = markSessionNotificationsRead(inbox, 'TASK-1');
    assert.strictEqual(unreadCount(read), 1);
  });

  await t.test('nothing belonging to another task', () => {
    const read = markSessionNotificationsRead(inbox, 'TASK-1');
    assert.strictEqual(read.find((item) => item.id === other.id)?.read, false);
  });
});
