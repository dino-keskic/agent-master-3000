import test from 'node:test';
import assert from 'node:assert';
import { boardDigest, taskDetail } from '../../../shared/manager/digest.js';
import { formatAge, renderBoardDigest, renderTaskDetail } from '../../../shared/manager/render.js';
import { BoardColumn } from '../../../shared/types.js';
import { question, task } from '../../fixtures/boardTasks.js';

const columns = [{ id: 'execute', title: 'In progress' }] as BoardColumn[];
const MIN = 60_000;

test('ages are relative and coarse', () => {
  assert.equal(formatAge(1_000, 1_000), 'just now');
  assert.equal(formatAge(0, 5 * MIN), '5m ago');
  assert.equal(formatAge(0, 3 * 60 * MIN), '3h ago');
  assert.equal(formatAge(0, 72 * 60 * MIN), '3d ago');
});

test('the overview groups tasks under headings and shows only the buckets that have any', () => {
  const now = 10 * MIN;
  const text = renderBoardDigest(boardDigest([
    task({ id: 'TASK-1', title: 'Blocked', pendingRequest: question, updatedAt: now - 2 * MIN }),
    task({ id: 'TASK-2', title: 'Resting', lastUserMessage: 'do it', lastMessage: 'All done.', updatedAt: now })
  ], columns, now));

  assert.match(text, /^2 tasks: 1 blocked on the user, 0 failed, 0 running, 1 idle\./);
  assert.match(text, /## Blocked on the user\n- TASK-1 "Blocked" \(column In progress, updated 2m ago\)\n {2}blocked on: question: Which branch/);
  assert.match(text, /## Idle[^\n]*\n- TASK-2 "Resting"[^\n]*\n {2}last asked: do it\n {2}last reply: All done\./);
  assert.doesNotMatch(text, /## Failed|## Running/);
});

test('an empty board says so', () => {
  assert.equal(renderBoardDigest(boardDigest([], columns, 0)), 'The board has no tasks.');
});

test('task detail shows the request and the conversation oldest first', () => {
  const now = 10 * MIN;
  const text = renderTaskDetail(taskDetail(task({
    logs: [
      { id: 'a', type: 'user_say', text: 'add a button', timestamp: now - 5 * MIN },
      { id: 'b', type: 'agent_say', text: 'Added.', timestamp: now - MIN }
    ]
  }), columns), now);
  assert.match(text, /## Original request\ndo it/);
  assert.match(text, /\[user, 5m ago\] add a button\n\n\[agent, 1m ago\] Added\./);
});
