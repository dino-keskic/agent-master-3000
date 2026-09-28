import test from 'node:test';
import assert from 'node:assert';
import {
  archivedAt,
  archivedTasks,
  isArchived,
  isLive,
  liveTasks,
  restoreColumnId,
  restoreRehomes,
  splitByArchive
} from '../../../shared/task/archive.js';
import { BoardTask } from '../../../shared/types.js';

/** Which tasks are on the board, which are recoverable, and where they return to. */

function task(id: string, patch: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title: id,
    description: '',
    prompt: 'p',
    columnId: 'backlog',
    runState: 'idle',
    model: 'm',
    agent: 'a',
    thinkingLevel: 'default',
    cwd: '/tmp',
    createdAt: 1,
    updatedAt: 1,
    logs: [],
    ...patch
  };
}

const columns = [{ id: 'backlog' }, { id: 'plan' }, { id: 'done' }];

test('a task with no archive stamp is live, so old boards need no migration', () => {
  const legacy = task('TASK-1');
  assert.strictEqual(archivedAt(legacy), undefined);
  assert.strictEqual(isArchived(legacy), false);
  assert.strictEqual(isLive(legacy), true);

  // Anything that is not a real epoch reads as live rather than as half-archived.
  assert.strictEqual(isArchived(task('TASK-2', { archivedAt: undefined })), false);
  assert.strictEqual(isArchived(task('TASK-3', { archivedAt: Number.NaN })), false);
});

test('a stamped task is archived and leaves the live list', () => {
  const live = task('TASK-1');
  const archived = task('TASK-2', { archivedAt: 5 });

  assert.strictEqual(isArchived(archived), true);
  assert.strictEqual(archivedAt(archived), 5);
  assert.deepStrictEqual(liveTasks([live, archived]).map((t) => t.id), ['TASK-1']);
  // Zero is a real epoch, and must not read as "no stamp".
  assert.strictEqual(isArchived(task('TASK-3', { archivedAt: 0 })), true);
});

test('the recovery list reads newest archive first', () => {
  const tasks = [
    task('TASK-1', { archivedAt: 100 }),
    task('TASK-2'),
    task('TASK-3', { archivedAt: 300 }),
    task('TASK-4', { archivedAt: 200 })
  ];

  assert.deepStrictEqual(archivedTasks(tasks).map((t) => t.id), ['TASK-3', 'TASK-4', 'TASK-1']);
});

test('a column cleared in one millisecond still has one stable order', () => {
  const tasks = [
    task('TASK-2', { archivedAt: 50, updatedAt: 9 }),
    task('TASK-1', { archivedAt: 50, updatedAt: 9 }),
    task('TASK-3', { archivedAt: 50, updatedAt: 12 })
  ];

  assert.deepStrictEqual(archivedTasks(tasks).map((t) => t.id), ['TASK-3', 'TASK-1', 'TASK-2']);
});

test('sorting the archive does not reorder the caller list', () => {
  const tasks = [task('TASK-1', { archivedAt: 1 }), task('TASK-2', { archivedAt: 9 })];
  archivedTasks(tasks);
  assert.deepStrictEqual(tasks.map((t) => t.id), ['TASK-1', 'TASK-2']);
});

test('splitByArchive returns the board and the archive in the orders each wants', () => {
  const tasks = [
    task('TASK-1', { archivedAt: 100 }),
    task('TASK-2'),
    task('TASK-3', { archivedAt: 300 }),
    task('TASK-4')
  ];

  const { live, archived } = splitByArchive(tasks);
  assert.deepStrictEqual(live.map((t) => t.id), ['TASK-2', 'TASK-4']);
  assert.deepStrictEqual(archived.map((t) => t.id), ['TASK-3', 'TASK-1']);
});

test('a restore returns a task to its own column when that column still exists', () => {
  assert.strictEqual(restoreColumnId(task('TASK-1', { columnId: 'plan' }), columns), 'plan');
  assert.strictEqual(restoreRehomes(task('TASK-1', { columnId: 'plan' }), columns), false);
});

test('a restore whose column was deleted lands in the first column', () => {
  const orphan = task('TASK-1', { columnId: 'review' });
  assert.strictEqual(restoreColumnId(orphan, columns), 'backlog');
  assert.strictEqual(restoreRehomes(orphan, columns), true);
});

test('with no columns at all a restore falls back to the seeded backlog id', () => {
  assert.strictEqual(restoreColumnId(task('TASK-1', { columnId: 'review' }), []), 'backlog');
});
