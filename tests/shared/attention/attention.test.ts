import test from 'node:test';
import assert from 'node:assert';
import { attentionItems, attentionLabel } from '../../../shared/attention/attention.js';
import { permission, question, task } from '../../fixtures/boardTasks.js';

/** The strip above the columns: what needs you, most urgent first. */

const withReject = {
  ...permission,
  options: [
    { optionId: 'no', name: 'Reject', kind: 'reject_once' as const },
    { optionId: 'yes', name: 'Allow', kind: 'allow_once' as const }
  ]
};

test('a permission prompt carries the answers that can be given in place', () => {
  const [item] = attentionItems([task({ sessionId: 's1', runState: 'awaiting_input', pendingRequest: withReject })]);
  assert.strictEqual(item?.kind, 'permission');
  assert.strictEqual(item?.allowOptionId, 'yes');
  assert.strictEqual(item?.rejectOptionId, 'no');
  assert.strictEqual(item?.requestId, 'req-1');
  assert.match(item?.detail || '', /npm test/);
});

test('a question shows its first line and offers no inline answer', () => {
  const [item] = attentionItems([
    task({ sessionId: 's1', runState: 'awaiting_input', pendingRequest: { ...question, message: 'Which branch?\nmain or dev' } })
  ]);
  assert.strictEqual(item?.kind, 'question');
  assert.strictEqual(item?.detail, 'Which branch?');
  assert.strictEqual(item?.allowOptionId, undefined);
});

test('a failed task is listed once, and not while it is blocked or retrying', () => {
  const failed = attentionItems([task({ runState: 'error', error: 'boom\nstack' })]);
  assert.deepStrictEqual(failed.map((item) => [item.kind, item.detail]), [['error', 'boom']]);

  const retrying = attentionItems([task({ runState: 'running', error: 'earlier' })]);
  assert.deepStrictEqual(retrying, []);

  const blocked = attentionItems([
    task({ sessionId: 's1', runState: 'awaiting_input', pendingRequest: permission, error: 'earlier' })
  ]);
  assert.deepStrictEqual(blocked.map((item) => item.kind), ['permission']);
});

test('an unread finished turn becomes a review, unless the task is busy or gone', () => {
  const inbox = [
    { id: 'n1', event: 'turn_complete' as const, taskId: 'TASK-1', createdAt: 50, read: false },
    { id: 'n2', event: 'turn_complete' as const, taskId: 'TASK-2', createdAt: 60, read: true },
    { id: 'n3', event: 'turn_complete' as const, taskId: 'TASK-9', createdAt: 70, read: false }
  ];
  const items = attentionItems([task(), task({ id: 'TASK-2' })], inbox);
  assert.deepStrictEqual(items.map((item) => [item.kind, item.taskId, item.notificationId]), [['review', 'TASK-1', 'n1']]);

  assert.deepStrictEqual(attentionItems([task({ runState: 'running' })], inbox), []);
});

test('ranked permission, question, error, review — oldest first within a kind', () => {
  const items = attentionItems(
    [
      task({ id: 'A' }),
      task({ id: 'B', runState: 'error', error: 'x' }),
      task({ id: 'C', sessionId: 'c', runState: 'awaiting_input', pendingRequest: question }),
      task({ id: 'D', sessionId: 'd', runState: 'awaiting_input', pendingRequest: { ...permission, askedAt: 30 } }),
      task({ id: 'E', sessionId: 'e', runState: 'awaiting_input', pendingRequest: { ...permission, askedAt: 20 } })
    ],
    [{ id: 'n', event: 'turn_complete', taskId: 'A', createdAt: 1, read: false }]
  );
  assert.deepStrictEqual(items.map((item) => item.taskId), ['E', 'D', 'C', 'B', 'A']);
});

test('the top bar count reads as a sentence', () => {
  assert.strictEqual(attentionLabel(0), '');
  assert.strictEqual(attentionLabel(1), '1 needs you');
  assert.strictEqual(attentionLabel(3), '3 need you');
});
