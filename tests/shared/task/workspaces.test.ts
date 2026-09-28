import test from 'node:test';
import assert from 'node:assert';
import { taskWorkspaces, workspaceTitle } from '../../../shared/task/workspaces.js';
import { ProjectFolder } from '../../../shared/types.js';
import { link, task } from '../../fixtures/boardTasks.js';

const board: ProjectFolder = { id: 'p1', name: 'agent-master-3000', path: '/code/agent-master-3000', createdAt: 1 };
const web: ProjectFolder = { id: 'p2', name: 'web-app', path: '/code/web-app', createdAt: 2 };
const projects = [board, web];

const inBoard = (overrides = {}) => task({ cwd: '/code/agent-master-3000', projectId: 'p1', ...overrides });

test('a task working in one folder is one workspace', () => {
  const list = taskWorkspaces(inBoard({ sessions: [link({ sessionId: 's' })] }), projects);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0]?.cwd, '/code/agent-master-3000');
  assert.strictEqual(list[0]?.projectName, 'agent-master-3000');
  assert.strictEqual(list[0]?.isTaskFolder, true);
  // The session follows the task's folder, so it belongs to that workspace.
  assert.deepStrictEqual(list[0]?.sessionIds, ['s']);
});

test('a session sent to another project adds that project to the list', () => {
  const list = taskWorkspaces(
    inBoard({
      sessions: [
        link({ sessionId: 'here' }),
        link({ sessionId: 'away', cwd: '/code/web-app', projectId: 'p2' })
      ]
    }),
    projects
  );
  assert.deepStrictEqual(list.map((w) => w.cwd), ['/code/agent-master-3000', '/code/web-app']);
  assert.deepStrictEqual(list.map((w) => w.projectName), ['agent-master-3000', 'web-app']);
  assert.deepStrictEqual(list.map((w) => w.sessionIds), [['here'], ['away']]);
  assert.strictEqual(list[1]?.isTaskFolder, false);
});

test('two checkouts of one project are two workspaces', () => {
  const list = taskWorkspaces(
    inBoard({
      sessions: [
        link({ sessionId: 'main' }),
        link({ sessionId: 'cut', cwd: '/code/agent-master-3000.worktrees/fix' })
      ]
    }),
    projects
  );
  assert.deepStrictEqual(list.map((w) => w.label), ['agent-master-3000', 'fix']);
  // A sibling checkout is still the project's, and says which one it is.
  assert.strictEqual(list[1]?.projectName, 'agent-master-3000');
  assert.strictEqual(list[1]?.isWorktree, true);
  assert.strictEqual(list[0]?.isWorktree, false);
});

test('sessions in the same folder share its workspace, however they got there', () => {
  const list = taskWorkspaces(
    inBoard({
      sessions: [
        link({ sessionId: 'a', cwd: '/code/web-app' }),
        link({ sessionId: 'b', cwd: '/code/web-app/' })
      ]
    }),
    projects
  );
  assert.deepStrictEqual(list.map((w) => w.cwd), ['/code/agent-master-3000', '/code/web-app']);
  assert.deepStrictEqual(list[1]?.sessionIds, ['a', 'b']);
});

test('an archived session is history — its folder is not still being worked in', () => {
  const list = taskWorkspaces(
    inBoard({ sessions: [link({ sessionId: 'old', cwd: '/code/web-app', archivedAt: 5 })] }),
    projects
  );
  assert.deepStrictEqual(list.map((w) => w.cwd), ['/code/agent-master-3000']);
});

test('the folder on screen leads, so the tab opens where the session is', () => {
  const spread = inBoard({
    sessions: [link({ sessionId: 'here' }), link({ sessionId: 'away', cwd: '/code/web-app' })]
  });
  assert.deepStrictEqual(
    taskWorkspaces(spread, projects, '/code/web-app').map((w) => w.cwd),
    ['/code/web-app', '/code/agent-master-3000']
  );
  // A folder the task does not work in cannot reorder anything.
  assert.deepStrictEqual(
    taskWorkspaces(spread, projects, '/tmp/elsewhere').map((w) => w.cwd),
    ['/code/agent-master-3000', '/code/web-app']
  );
});

test('a folder in no project is still somewhere work happens', () => {
  const list = taskWorkspaces(task({ cwd: '/tmp/scratch' }), projects);
  assert.strictEqual(list[0]?.projectName, undefined);
  assert.strictEqual(list[0]?.label, 'scratch');
  assert.strictEqual(taskWorkspaces(task({ cwd: '' }), projects).length, 0);
});

test('a workspace is named by whichever of project and folder is in question', () => {
  const [root, worktree] = taskWorkspaces(
    inBoard({ sessions: [link({ sessionId: 'cut', cwd: '/code/agent-master-3000.worktrees/fix' })] }),
    projects
  );
  assert.strictEqual(workspaceTitle(root!), 'agent-master-3000');
  assert.strictEqual(workspaceTitle(worktree!), 'agent-master-3000 · fix');
  assert.strictEqual(workspaceTitle(taskWorkspaces(task({ cwd: '/tmp/scratch' }))[0]!), 'scratch');
});
