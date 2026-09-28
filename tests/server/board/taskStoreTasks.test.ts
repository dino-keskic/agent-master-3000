import test, { after } from 'node:test';
import assert from 'node:assert';
import { freshStore } from '../../fixtures/taskStore.js';

/** Cards: making them, patching them, moving them, deleting them. */

const { store, cleanup } = freshStore('tasks');
after(cleanup);

test('a new board starts with tasks and projects to list', () => {
  const settings = store.getSettings();
  assert.ok(Array.isArray(store.getTasks()));
  assert.ok(Array.isArray(settings.projects));
  assert.strictEqual(settings.defaultModel, 'github-copilot/claude-sonnet-4.6');
});

test('a created task lands in the backlog, idle, with what was asked for', () => {
  const before = store.getTasks().length;
  const newTask = store.createTask({
    title: 'Implement Authentication',
    prompt: 'Add JWT auth in server/auth.ts',
    model: 'github-copilot/gpt-4o',
    agent: 'coder',
    thinkingLevel: 'high'
  });

  assert.ok(newTask.id.startsWith('TASK-'));
  assert.strictEqual(newTask.title, 'Implement Authentication');
  assert.strictEqual(newTask.columnId, 'backlog');
  assert.strictEqual(newTask.runState, 'idle');
  assert.strictEqual(newTask.model, 'github-copilot/gpt-4o');
  assert.strictEqual(newTask.thinkingLevel, 'high');

  const tasks = store.getTasks();
  assert.strictEqual(tasks.length, before + 1);
  assert.strictEqual(tasks[tasks.length - 1]!.id, newTask.id);
});

test('column moves do not change runState', () => {
  const { id } = store.createTask({ title: 'Moves', prompt: 'p' });

  const planned = store.moveTask(id, 'plan', { applyConfig: true });
  assert.ok(planned);
  assert.strictEqual(planned?.columnId, 'plan');
  assert.strictEqual(planned?.runState, 'idle');

  const running = store.setRunState(id, 'running');
  assert.strictEqual(running?.runState, 'running');
  assert.strictEqual(running?.columnId, 'plan');

  const executed = store.moveTask(id, 'execute');
  assert.strictEqual(executed?.columnId, 'execute');
  assert.strictEqual(executed?.runState, 'running');

  store.setRunState(id, 'idle');
});

test('a patch reaches the fields it names', () => {
  const { id } = store.createTask({ title: 'Auth', prompt: 'p' });

  const patched = store.updateTask(id, { title: 'Updated Auth Title', thinkingLevel: 'max' });

  assert.strictEqual(patched?.title, 'Updated Auth Title');
  assert.strictEqual(patched?.thinkingLevel, 'max');
});

test('a patch cannot overwrite the id or wipe the logs', () => {
  const task = store.createTask({ title: 'Patch me', prompt: 'p' });
  const patched = store.updateTask(task.id, { title: 'Patched', id: 'TASK-HACK', logs: [] });
  assert.strictEqual(patched?.id, task.id);
  assert.ok((patched?.logs.length || 0) >= 1);
  assert.strictEqual(patched?.title, 'Patched');
});

test('projects can be added and removed', () => {
  const proj = store.addProject('Frontend App', '/projects/agent-master-3000/src');
  assert.ok(proj.id);
  assert.strictEqual(proj.name, 'Frontend App');
  assert.strictEqual(proj.path, '/projects/agent-master-3000/src');

  let settings = store.getSettings();
  assert.ok(settings.projects.some((p) => p.id === proj.id));

  store.deleteProject(proj.id);
  settings = store.getSettings();
  assert.ok(!settings.projects.some((p) => p.id === proj.id));
});

test('a deleted task is gone from the board', () => {
  const tempTask = store.createTask({ title: 'Task To Delete', prompt: 'Temporary prompt' });

  assert.strictEqual(store.deleteTask(tempTask.id), true);
  assert.ok(!store.getTasks().some((t) => t.id === tempTask.id));
});

test('an archived task leaves the board keeping everything it held', () => {
  const task = store.createTask({ title: 'Archive me', prompt: 'p', columnId: 'plan' });
  store.addLogToTask(task.id, { id: 'l1', timestamp: 1, type: 'user_say', text: 'hello' });

  const archived = store.archiveTask(task.id);
  assert.ok(archived?.archivedAt);
  assert.strictEqual(archived?.runState, 'idle');
  assert.ok(archived?.logs.some((log) => log.id === 'l1'));
  assert.ok(!store.listLiveTasks().some((t) => t.id === task.id));
  assert.ok(store.listArchivedTasks().some((t) => t.id === task.id));
  // Still in state, so nothing about it was lost.
  assert.ok(store.getTask(task.id));

  const restored = store.restoreTask(task.id);
  assert.strictEqual(restored?.archivedAt, undefined);
  assert.strictEqual(restored?.columnId, 'plan');
  assert.ok(store.listLiveTasks().some((t) => t.id === task.id));
  store.deleteTask(task.id);
});

test('a restore whose column is gone lands in the first column', () => {
  const columns = store.getSettings().columns;
  const task = store.createTask({ title: 'Orphan', prompt: 'p', columnId: 'plan' });
  store.archiveTask(task.id);
  store.updateSettings({ columns: columns.filter((column) => column.id !== 'plan') });

  const restored = store.restoreTask(task.id);
  assert.strictEqual(restored?.columnId, store.getSettings().columns[0]!.id);

  store.deleteTask(task.id);
  store.updateSettings({ columns });
});

test('clearing a column archives only that column, and only what is still live', () => {
  const inbox = store.createTask({ title: 'Keep me', prompt: 'stay', columnId: 'backlog' });
  const a = store.createTask({ title: 'Gone A', prompt: 'a', columnId: 'execute' });
  const b = store.createTask({ title: 'Gone B', prompt: 'b', columnId: 'execute' });
  const archived = store.archiveTasksInColumn('execute');
  assert.ok(archived.includes(a.id));
  assert.ok(archived.includes(b.id));
  assert.ok(!archived.includes(inbox.id));
  const live = store.listLiveTasks();
  assert.ok(live.some((t) => t.id === inbox.id));
  assert.ok(live.every((t) => t.columnId !== 'execute'));
  // Already archived, so a second clear has nothing left to take.
  assert.deepStrictEqual(store.archiveTasksInColumn('execute'), []);

  store.deleteTask(a.id);
  store.deleteTask(b.id);
  store.deleteTask(inbox.id);
});

test('task ids never collide after deletes', () => {
  const a = store.createTask({ title: 'A', prompt: 'a' });
  const b = store.createTask({ title: 'B', prompt: 'b' });
  store.deleteTask(a.id);
  const c = store.createTask({ title: 'C', prompt: 'c' });
  assert.notStrictEqual(c.id, a.id);
  assert.notStrictEqual(c.id, b.id);
  const ids = store.getTasks().map((t) => t.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('deleting a column moves its tasks to the first remaining one', () => {
  const task = store.createTask({ title: 'Parked', prompt: 'p', columnId: 'deliver' });
  assert.strictEqual(task.columnId, 'deliver');
  store.updateSettings({ columns: store.getSettings().columns.filter((c) => c.id !== 'deliver') });
  assert.strictEqual(store.getTask(task.id)?.columnId, 'backlog');
  assert.ok(!store.getSettings().columns.some((c) => c.id === 'deliver'));
});
