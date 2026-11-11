import test from 'node:test';
import assert from 'node:assert';
import { boardOrder, stepTask, workGroups } from '../../../shared/board/workList.js';
import { task } from '../../fixtures/boardTasks.js';

/** The list beside an open task, and stepping through the board by keyboard. */

test('tasks are grouped by whether they want something, newest first', () => {
  const groups = workGroups([
    task({ id: 'idle-old', updatedAt: 1 }),
    task({ id: 'idle-new', updatedAt: 9 }),
    task({ id: 'run', runState: 'running' }),
    task({ id: 'ask', runState: 'awaiting_input' }),
    task({ id: 'broke', error: 'x' })
  ]);
  assert.deepStrictEqual(groups.map((group) => group.title), ['Needs you', 'Running', 'Idle']);
  assert.deepStrictEqual(groups[0]?.tasks.map((t) => t.id).sort(), ['ask', 'broke']);
  assert.deepStrictEqual(groups[2]?.tasks.map((t) => t.id), ['idle-new', 'idle-old']);
});

test('a retry in flight is running, not a failure', () => {
  assert.deepStrictEqual(workGroups([task({ runState: 'running', error: 'earlier' })]).map((group) => group.id), ['running']);
});

test('empty groups are left out', () => {
  assert.deepStrictEqual(workGroups([task()]).map((group) => group.id), ['idle']);
});

test('reading order is down each column, left to right', () => {
  const tasks = [task({ id: 'b1', columnId: 'b' }), task({ id: 'a1', columnId: 'a' }), task({ id: 'a2', columnId: 'a' })];
  assert.deepStrictEqual(boardOrder(tasks, [{ id: 'a' }, { id: 'b' }]), ['a1', 'a2', 'b1']);
});

test('stepping stops at the ends and starts from the nearest edge', () => {
  const order = ['a', 'b', 'c'];
  assert.strictEqual(stepTask(order, 'a', 1), 'b');
  assert.strictEqual(stepTask(order, 'c', 1), 'c');
  assert.strictEqual(stepTask(order, 'a', -1), 'a');
  assert.strictEqual(stepTask(order, undefined, 1), 'a');
  assert.strictEqual(stepTask(order, undefined, -1), 'c');
  assert.strictEqual(stepTask([], 'a', 1), undefined);
});
