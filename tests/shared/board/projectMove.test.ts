import test from 'node:test';
import assert from 'node:assert';
import {
  applySessionProjectPatch,
  applyTaskProjectMove,
  planSessionProjectMove,
  planTaskProjectMove
} from '../../../shared/board/projectMove.js';
import { ProjectFolder } from '../../../shared/types.js';
import { link, task } from '../../fixtures/boardTasks.js';

const boardProject: ProjectFolder = { id: 'p1', name: 'agent-master-3000', path: '/code/agent-master-3000', createdAt: 1 };
const webProject: ProjectFolder = { id: 'p2', name: 'web-app', path: '/code/web-app', createdAt: 2 };
const projects = [boardProject, webProject];

const inBoard = (overrides = {}) =>
  task({ cwd: '/code/agent-master-3000', projectId: 'p1', ...overrides });

test('a move rewrites both halves of where the task lives', () => {
  const move = planTaskProjectMove(inBoard(), { project: webProject }, projects);
  assert.strictEqual(move?.projectId, 'p2');
  assert.strictEqual(move?.cwd, '/code/web-app');
  assert.match(move.log, /Moved to project web-app — turns now run in \/code\/web-app\./);
});

test('a task already in the project has nothing to move', () => {
  assert.strictEqual(planTaskProjectMove(inBoard(), { project: boardProject }, projects), null);
});

test('work already inside the target keeps the folder it is in', () => {
  // A worktree of web-app is web-app's; the move must not drag it to the root.
  const worktree = task({ cwd: '/code/web-app.worktrees/feature-x' });
  const move = planTaskProjectMove(worktree, { project: webProject }, projects);
  assert.strictEqual(move?.cwd, '/code/web-app.worktrees/feature-x');
  assert.strictEqual(move?.projectId, 'p2');
  assert.strictEqual(move?.log, 'Moved to project web-app.');
});

test('sessions working in the task folder come along, in whichever way they follow it', () => {
  const moved = inBoard({
    sessionId: 'ses_main',
    sessions: [
      link({ sessionId: 'ses_main', cwd: '/code/agent-master-3000', projectId: 'p1', projectName: 'agent-master-3000' }),
      link({ sessionId: 'ses_implicit', projectName: 'agent-master-3000' })
    ]
  });
  const move = planTaskProjectMove(moved, { project: webProject }, projects);
  assert.deepStrictEqual(move?.sessions, [
    { sessionId: 'ses_main', cwd: '/code/web-app', projectId: 'p2', projectName: 'web-app' },
    { sessionId: 'ses_implicit', cwd: undefined, projectId: 'p2', projectName: 'web-app' }
  ]);
});

test('a session deliberately put somewhere else is left where it is', () => {
  const moved = inBoard({
    sessions: [
      link({ sessionId: 'ses_away', cwd: '/tmp/scratch', projectName: 'scratch' }),
      // History records where it actually ran, so it is not rewritten either.
      link({ sessionId: 'ses_old', cwd: '/code/agent-master-3000', archivedAt: 5, projectName: 'agent-master-3000' })
    ]
  });
  assert.deepStrictEqual(planTaskProjectMove(moved, { project: webProject }, projects)?.sessions, []);
});

test('a stale session label is corrected even when the task itself stays put', () => {
  const stale = task({ cwd: '/code/web-app', projectId: 'p2', sessions: [link({ sessionId: 's', projectName: 'agent-master-3000' })] });
  const move = planTaskProjectMove(stale, { project: webProject }, projects);
  assert.strictEqual(move?.cwd, '/code/web-app');
  assert.deepStrictEqual(move?.sessions.map((s) => s.projectName), ['web-app']);
});

test('dropping the project keeps the folder — there is nowhere else to run', () => {
  const move = planTaskProjectMove(inBoard(), undefined, projects);
  assert.strictEqual(move?.projectId, undefined);
  assert.strictEqual(move?.cwd, '/code/agent-master-3000');
  assert.strictEqual(move?.log, 'Removed from project agent-master-3000.');
  assert.strictEqual(planTaskProjectMove(task({ cwd: '/tmp/x' }), undefined, projects), null);
});

test('applying a move writes the task and the links it carried', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's', cwd: '/code/agent-master-3000' })] });
  applyTaskProjectMove(moved, planTaskProjectMove(moved, { project: webProject }, projects)!);
  assert.strictEqual(moved.cwd, '/code/web-app');
  assert.strictEqual(moved.projectId, 'p2');
  assert.strictEqual(moved.sessions?.[0]?.cwd, '/code/web-app');
  assert.strictEqual(moved.sessions?.[0]?.projectName, 'web-app');
});

test('one session can be sent to another project without the task following', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's' })] });
  const plan = planSessionProjectMove(moved, 's', { project: webProject }, projects);
  assert.deepStrictEqual(plan?.patch, {
    sessionId: 's',
    cwd: '/code/web-app',
    projectId: 'p2',
    projectName: 'web-app'
  });
  assert.strictEqual(plan?.log, 'Session "Session" moved to project web-app (/code/web-app).');

  applySessionProjectPatch(moved, plan.patch);
  assert.strictEqual(moved.cwd, '/code/agent-master-3000');
  assert.strictEqual(moved.sessions?.[0]?.cwd, '/code/web-app');
});

test("sending a session home clears what it was carrying, rather than pinning it", () => {
  const moved = inBoard({
    sessions: [link({ sessionId: 's', cwd: '/code/web-app', projectId: 'p2', projectName: 'web-app' })]
  });
  const home = planSessionProjectMove(moved, 's', { project: boardProject }, projects);
  assert.deepStrictEqual(home?.patch, { sessionId: 's' });

  applySessionProjectPatch(moved, home.patch);
  assert.strictEqual(moved.sessions?.[0]?.cwd, undefined);
  assert.strictEqual(moved.sessions?.[0]?.projectName, undefined);
  // And "follow the task" says the same thing without naming a project.
  assert.strictEqual(planSessionProjectMove(moved, 's', undefined, projects), null);
});

test('a session already in the target, or not on this task at all, plans nothing', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's', cwd: '/code/web-app', projectId: 'p2', projectName: 'web-app' })] });
  assert.strictEqual(planSessionProjectMove(moved, 's', { project: webProject }, projects), null);
  assert.strictEqual(planSessionProjectMove(moved, 'nope', { project: webProject }, projects), null);
});

test("a session in a worktree keeps it when its own project is the target", () => {
  const moved = inBoard({
    sessions: [link({ sessionId: 's', cwd: '/code/web-app.worktrees/feature-x' })]
  });
  assert.strictEqual(planSessionProjectMove(moved, 's', { project: webProject }, projects)?.patch.cwd, '/code/web-app.worktrees/feature-x');
});

test('a named folder moves the work to that checkout, under whoever owns it', () => {
  const move = planTaskProjectMove(inBoard(), { cwd: '/code/web-app.worktrees/feature-x' }, projects);
  assert.strictEqual(move?.cwd, '/code/web-app.worktrees/feature-x');
  // The folder decides the project, so naming one is not required.
  assert.strictEqual(move?.projectId, 'p2');
  assert.match(move.log, /^Moved to project web-app — turns now run in/);
});

test('switching worktree inside one project is a move, not a no-op', () => {
  const move = planTaskProjectMove(inBoard(), { project: boardProject, cwd: '/code/agent-master-3000.worktrees/fix' }, projects);
  assert.strictEqual(move?.projectId, 'p1');
  assert.strictEqual(move?.cwd, '/code/agent-master-3000.worktrees/fix');
  assert.strictEqual(move.log, 'Moved within agent-master-3000 — turns now run in /code/agent-master-3000.worktrees/fix.');
});

test('a folder in no project leaves the task untagged, where the folder says it is', () => {
  const move = planTaskProjectMove(inBoard(), { cwd: '/tmp/scratch' }, projects);
  assert.strictEqual(move?.projectId, undefined);
  assert.strictEqual(move?.cwd, '/tmp/scratch');
  assert.strictEqual(move.log, 'Turns now run in /tmp/scratch.');
});

test('the sessions following a task land in the named checkout with it', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's', cwd: '/code/agent-master-3000' })] });
  const move = planTaskProjectMove(moved, { project: webProject, cwd: '/code/web-app.worktrees/feature-x' }, projects);
  assert.deepStrictEqual(move?.sessions, [
    { sessionId: 's', cwd: '/code/web-app.worktrees/feature-x', projectId: 'p2', projectName: 'web-app' }
  ]);
});

test('one session can be sent to a worktree of the project the task is already in', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's' })] });
  const plan = planSessionProjectMove(moved, 's', { cwd: '/code/agent-master-3000.worktrees/fix' }, projects);
  assert.deepStrictEqual(plan?.patch, {
    sessionId: 's',
    cwd: '/code/agent-master-3000.worktrees/fix',
    projectId: 'p1',
    projectName: 'agent-master-3000'
  });
  assert.strictEqual(plan.log, 'Session "Session" moved to project agent-master-3000 (/code/agent-master-3000.worktrees/fix).');
});

test('a session moved mid-turn is told when it will be felt', () => {
  const moved = inBoard({ sessions: [link({ sessionId: 's' })] });
  const plan = planSessionProjectMove(moved, 's', { project: webProject }, projects, { turnInFlight: true });
  assert.match(plan!.log, /It takes effect on the next turn\.$/);
});
