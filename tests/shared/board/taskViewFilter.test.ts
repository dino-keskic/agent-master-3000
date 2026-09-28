import test from 'node:test';
import assert from 'node:assert';
import { TaskChangeSummary } from '../../../shared/git/changeSummary.js';
import {
  countChangedFiles,
  countUpdatedToday,
  filterTasksForView,
  hasChangedFiles,
  isUpdatedToday,
  toggleTaskView
} from '../../../shared/board/taskViewFilter.js';

/** Wednesday 22 Sep 2026, mid-afternoon, local time. */
const now = new Date(2026, 8, 22, 15).getTime();
const today = new Date(2026, 8, 22, 9).getTime();
const yesterday = new Date(2026, 8, 21, 23, 59).getTime();

function summary(files: number): TaskChangeSummary {
  return {
    scope: 'uncommitted',
    workspaces: [
      {
        cwd: '/repo',
        label: 'repo',
        stat: { files, additions: files, deletions: 0 },
        files: [],
        truncated: false
      }
    ]
  };
}

const tasks = [
  { id: 'today-dirty', updatedAt: today },
  { id: 'today-clean', updatedAt: today },
  { id: 'old-dirty', updatedAt: yesterday },
  { id: 'old-clean', updatedAt: yesterday }
];

const summaries: Record<string, TaskChangeSummary> = {
  'today-dirty': summary(2),
  'today-clean': summary(0),
  'old-dirty': summary(4),
  'old-clean': summary(0)
};

test('today is the local calendar day, midnight included and the previous day not', () => {
  const midnight = new Date(2026, 8, 22, 0, 0, 0, 0).getTime();
  assert.strictEqual(isUpdatedToday(midnight, now), true);
  assert.strictEqual(isUpdatedToday(midnight - 1, now), false);
  assert.strictEqual(isUpdatedToday(Number.NaN, now), false);
});

test('a summary with no files is not a changed task', () => {
  assert.strictEqual(hasChangedFiles(summary(3)), true);
  assert.strictEqual(hasChangedFiles(summary(0)), false);
  assert.strictEqual(hasChangedFiles(undefined), false);
});

test('neither toggle returns the same array', () => {
  const view = { updatedToday: false, changedFiles: false };
  assert.strictEqual(filterTasksForView(tasks, view, summaries, now, true), tasks);
});

test('updated today hides yesterday, and stacks with changed files', () => {
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: true, changedFiles: false }, summaries, now, true).map((task) => task.id),
    ['today-dirty', 'today-clean']
  );
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: true, changedFiles: true }, summaries, now, true).map((task) => task.id),
    ['today-dirty']
  );
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: false, changedFiles: true }, summaries, now, true).map((task) => task.id),
    ['today-dirty', 'old-dirty']
  );
});

test('a change read still in flight keeps tasks it has not heard about, and drops ones it has', () => {
  const partial = { 'today-clean': summary(0) };
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: false, changedFiles: true }, partial, now, false).map((task) => task.id),
    ['today-dirty', 'old-dirty', 'old-clean']
  );
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: false, changedFiles: true }, partial, now, true).map((task) => task.id),
    []
  );
});

test('a failed change read does not hide the board', () => {
  assert.deepStrictEqual(
    filterTasksForView(tasks, { updatedToday: false, changedFiles: true }, summaries, now, false, true).map((task) => task.id),
    tasks.map((task) => task.id)
  );
});

test('counts are the two badges', () => {
  assert.strictEqual(countUpdatedToday(tasks, now), 2);
  assert.strictEqual(countChangedFiles(tasks, summaries), 2);
});

test('toggling one side leaves the other alone', () => {
  const todayOn = toggleTaskView({ updatedToday: false, changedFiles: true }, 'updatedToday');
  assert.deepStrictEqual(todayOn, { updatedToday: true, changedFiles: true });
  assert.deepStrictEqual(toggleTaskView(todayOn, 'changedFiles'), { updatedToday: true, changedFiles: false });
});
