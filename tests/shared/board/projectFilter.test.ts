import test from 'node:test';
import assert from 'node:assert';
import {
  UNASSIGNED_PROJECT,
  filterTasksByProjects,
  projectFilterChips,
  pruneProjectFilter,
  toggleProjectFilter
} from '../../../shared/board/projectFilter.js';
import { ProjectFolder } from '../../../shared/types.js';

const projects: ProjectFolder[] = [
  { id: 'p1', name: 'agent-master-3000', path: '/a', createdAt: 1 },
  { id: 'p2', name: 'web-app', path: '/b', createdAt: 2 },
  { id: 'p3', name: 'empty-one', path: '/c', createdAt: 3 }
];

const tasks = [
  { id: 't1', projectId: 'p1' },
  { id: 't2', projectId: 'p1' },
  { id: 't3', projectId: 'p2' },
  { id: 't4' }
];

test('no selection shows the whole board rather than nothing', () => {
  assert.strictEqual(filterTasksByProjects(tasks, []).length, 4);
});

test('a selection narrows to those projects, and stacks', () => {
  assert.deepStrictEqual(
    filterTasksByProjects(tasks, ['p1']).map((t) => t.id),
    ['t1', 't2']
  );
  assert.deepStrictEqual(
    filterTasksByProjects(tasks, ['p1', 'p2']).map((t) => t.id),
    ['t1', 't2', 't3']
  );
});

test('tasks with no project are their own bucket, not a wildcard', () => {
  assert.deepStrictEqual(
    filterTasksByProjects(tasks, [UNASSIGNED_PROJECT]).map((t) => t.id),
    ['t4']
  );
  // The old board always let untagged tasks through; now picking a project hides them.
  assert.deepStrictEqual(
    filterTasksByProjects(tasks, ['p2']).map((t) => t.id),
    ['t3']
  );
});

test('chips count each project and skip ones with nothing in them', () => {
  assert.deepStrictEqual(projectFilterChips(tasks, projects, []), [
    { id: 'p1', label: 'agent-master-3000', count: 2, selected: false },
    { id: 'p2', label: 'web-app', count: 1, selected: false },
    { id: UNASSIGNED_PROJECT, label: 'No project', count: 1, selected: false }
  ]);
});

test('a selected project keeps its chip after its last task leaves', () => {
  const chips = projectFilterChips(tasks, projects, ['p3']);
  assert.deepStrictEqual(chips.at(-2), { id: 'p3', label: 'empty-one', count: 0, selected: true });
});

test('the unassigned chip is absent when every task has a project', () => {
  const assigned = tasks.filter((task) => task.projectId);
  assert.ok(!projectFilterChips(assigned, projects, []).some((chip) => chip.id === UNASSIGNED_PROJECT));
});

test('toggling adds, removes, and empties back to unfiltered', () => {
  let selected = toggleProjectFilter([], 'p1');
  assert.deepStrictEqual(selected, ['p1']);
  selected = toggleProjectFilter(selected, 'p2');
  assert.deepStrictEqual(selected, ['p1', 'p2']);
  selected = toggleProjectFilter(selected, 'p1');
  assert.deepStrictEqual(selected, ['p2']);
  assert.deepStrictEqual(toggleProjectFilter(selected, 'p2'), []);
});

test('pruneProjectFilter drops ids no project answers to', () => {
  assert.deepStrictEqual(pruneProjectFilter(['p1', 'gone', UNASSIGNED_PROJECT], projects), [
    'p1',
    UNASSIGNED_PROJECT
  ]);
  // Unchanged input is returned as-is so it does not churn React state.
  const clean = ['p1', 'p2'];
  assert.strictEqual(pruneProjectFilter(clean, projects), clean);
});
