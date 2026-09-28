import test from 'node:test';
import assert from 'node:assert';
import {
  closeTask,
  EMPTY_LAYOUT,
  focusTask,
  layoutOf,
  MAX_PANES,
  openBeside,
  openTask,
  pruneLayout,
  splitCandidates
} from '../../../shared/board/splitLayout.js';
import { task } from '../../fixtures/boardTasks.js';

test('split layout', async (t) => {
  await t.test('a deep link lands focused on its last task, capped and deduplicated', () => {
    assert.deepEqual(layoutOf(['A', 'B', 'A']), { taskIds: ['A', 'B'], focusedId: 'B' });
    assert.equal(layoutOf(['A', 'B', 'C', 'D']).taskIds.length, MAX_PANES);
    assert.deepEqual(layoutOf([]), EMPTY_LAYOUT);
  });

  await t.test('a plain open shows one task, or replaces the focused panel', () => {
    const one = openTask(EMPTY_LAYOUT, 'A');
    assert.deepEqual(one, { taskIds: ['A'], focusedId: 'A' });
    const split = { taskIds: ['A', 'B'], focusedId: 'A' };
    assert.deepEqual(openTask(split, 'C'), { taskIds: ['C', 'B'], focusedId: 'C' });
  });

  await t.test('opening a task that is already open only focuses it', () => {
    const split = { taskIds: ['A', 'B'], focusedId: 'A' };
    assert.deepEqual(openTask(split, 'B'), { taskIds: ['A', 'B'], focusedId: 'B' });
    assert.deepEqual(openBeside(split, 'B'), { taskIds: ['A', 'B'], focusedId: 'B' });
  });

  await t.test('open beside goes right of the anchor and takes the focus', () => {
    const split = { taskIds: ['A', 'B'], focusedId: 'B' };
    assert.deepEqual(openBeside(split, 'C', 'A'), { taskIds: ['A', 'C', 'B'], focusedId: 'C' });
    assert.deepEqual(openBeside(split, 'C'), { taskIds: ['A', 'B', 'C'], focusedId: 'C' });
    assert.deepEqual(openBeside(EMPTY_LAYOUT, 'A'), { taskIds: ['A'], focusedId: 'A' });
  });

  await t.test('at the cap, open beside replaces the anchor', () => {
    const full = { taskIds: ['A', 'B', 'C'], focusedId: 'C' };
    assert.deepEqual(openBeside(full, 'D', 'B'), { taskIds: ['A', 'D', 'C'], focusedId: 'D' });
  });

  await t.test('closing moves focus to the panel that takes its place', () => {
    const full = { taskIds: ['A', 'B', 'C'], focusedId: 'B' };
    assert.deepEqual(closeTask(full, 'B'), { taskIds: ['A', 'C'], focusedId: 'C' });
    assert.deepEqual(closeTask({ ...full, focusedId: 'C' }, 'C'), { taskIds: ['A', 'B'], focusedId: 'B' });
    assert.deepEqual(closeTask(full, 'A'), { taskIds: ['B', 'C'], focusedId: 'B' });
    assert.deepEqual(closeTask(layoutOf(['A']), 'A'), EMPTY_LAYOUT);
  });

  await t.test('focus and close ignore tasks that are not open', () => {
    const split = { taskIds: ['A', 'B'], focusedId: 'A' };
    assert.strictEqual(focusTask(split, 'Z'), split);
    assert.strictEqual(focusTask(split, 'A'), split);
    assert.strictEqual(closeTask(split, 'Z'), split);
  });

  await t.test('pruning drops vanished tasks and keeps the reference otherwise', () => {
    const full = { taskIds: ['A', 'B', 'C'], focusedId: 'B' };
    assert.strictEqual(pruneLayout(full, () => true), full);
    assert.deepEqual(pruneLayout(full, (id) => id !== 'B'), { taskIds: ['A', 'C'], focusedId: 'C' });
    assert.deepEqual(pruneLayout(full, () => false), EMPTY_LAYOUT);
  });

  await t.test('open beside offers closed tasks, asks and running work first', () => {
    const tasks = [
      task({ id: 'TASK-1', title: 'Idle one', runState: 'idle' }),
      task({ id: 'TASK-2', title: 'Running one', runState: 'running' }),
      task({ id: 'TASK-3', title: 'Blocked one', runState: 'awaiting_input' }),
      task({ id: 'TASK-4', title: 'Open already', runState: 'running' })
    ];
    const ids = (list: { id: string }[]) => list.map((item) => item.id);
    assert.deepEqual(ids(splitCandidates(tasks, ['TASK-4'], '')), ['TASK-3', 'TASK-2', 'TASK-1']);
    assert.deepEqual(ids(splitCandidates(tasks, [], 'running')), ['TASK-2']);
    assert.deepEqual(ids(splitCandidates(tasks, [], 'task-1')), ['TASK-1']);
    assert.deepEqual(ids(splitCandidates(tasks, [], '', 1)), ['TASK-3']);
  });
});
