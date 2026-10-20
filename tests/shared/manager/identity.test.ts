import test from 'node:test';
import assert from 'node:assert';
import { MANAGER_TASK_ID, findManager, isManagerTask, withoutManager } from '../../../shared/manager/identity.js';
import { task } from '../../fixtures/boardTasks.js';

test('the manager is the task with the manager id', () => {
  assert.equal(isManagerTask(MANAGER_TASK_ID), true);
  assert.equal(isManagerTask(task({ id: MANAGER_TASK_ID })), true);
  assert.equal(isManagerTask(task()), false);
});

test('withoutManager drops the manager and keeps the array when there is none', () => {
  const first = task({ id: 'TASK-1' });
  const second = task({ id: 'TASK-2' });
  const plain = [first, second];
  assert.strictEqual(withoutManager(plain), plain);

  const manager = task({ id: MANAGER_TASK_ID });
  const mixed = [first, manager, second];
  assert.deepStrictEqual(withoutManager(mixed).map((t) => t.id), ['TASK-1', 'TASK-2']);
  assert.strictEqual(findManager(mixed), manager);
  assert.equal(findManager(plain), undefined);
});
