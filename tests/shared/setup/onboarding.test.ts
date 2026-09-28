import test from 'node:test';
import assert from 'node:assert';
import { BoardState, BoardTask, ProjectFolder } from '../../../shared/types.js';
import { cloneDefaultColumns } from '../../../shared/board/columns.js';
import { DEFAULT_PERMISSION_MODE } from '../../../shared/agent/permissions.js';
import { normalizeBoardState } from '../../../shared/board/normalize.js';
import {
  dropUnusedSeededProject,
  FolderActivity,
  needsOnboarding,
  SEEDED_PROJECT_ID,
  suggestProjects
} from '../../../shared/setup/onboarding.js';

const seeded: ProjectFolder = { id: SEEDED_PROJECT_ID, name: 'agent-master-3000', path: '/Users/ana', createdAt: 1 };
const mine: ProjectFolder = { id: 'proj-2', name: 'shop', path: '/code/shop', createdAt: 2 };

function board(projects: ProjectFolder[], tasks: Partial<BoardTask>[] = [], selectedProjectId?: string): BoardState {
  return {
    tasks: tasks as BoardTask[],
    nextTaskNumber: 101,
    settings: {
      defaultModel: 'm',
      defaultAgent: '',
      defaultThinkingLevel: 'default',
      defaultPermissionMode: DEFAULT_PERMISSION_MODE,
      defaultCwd: projects[0]?.path || '/Users/ana',
      selectedProjectId,
      projects,
      columns: cloneDefaultColumns()
    }
  };
}

test('a board nobody has worked on loses the project older versions seeded', () => {
  const state = board([seeded], [], SEEDED_PROJECT_ID);
  assert.strictEqual(dropUnusedSeededProject(state), true);
  assert.deepStrictEqual(state.settings.projects, []);
  assert.strictEqual(state.settings.selectedProjectId, undefined);
});

test('the seeded project stays on a board with any task, archived ones too', () => {
  const state = board([seeded], [{ id: 'TASK-101', archivedAt: 5 }], SEEDED_PROJECT_ID);
  assert.strictEqual(dropUnusedSeededProject(state), false);
  assert.strictEqual(state.settings.projects.length, 1);
});

test('dropping the seed selects a project the user added, if there is one', () => {
  const state = board([seeded, mine], [], SEEDED_PROJECT_ID);
  assert.strictEqual(dropUnusedSeededProject(state), true);
  assert.deepStrictEqual(state.settings.projects, [mine]);
  assert.strictEqual(state.settings.selectedProjectId, mine.id);
  assert.strictEqual(state.settings.defaultCwd, mine.path);
});

test('a board without the seed is left alone, and loading one repairs it', () => {
  assert.strictEqual(dropUnusedSeededProject(board([mine])), false);
  const loaded = board([seeded], [], SEEDED_PROJECT_ID);
  assert.strictEqual(normalizeBoardState(loaded), true);
  assert.deepStrictEqual(loaded.settings.projects, []);
});

test('only a board with neither projects nor tasks is greeted', () => {
  assert.strictEqual(needsOnboarding([], []), true);
  assert.strictEqual(needsOnboarding([mine], []), false);
  assert.strictEqual(needsOnboarding([], [{ id: 'TASK-101' }]), false);
});

const row = (directory: string, sessions: number, lastActive: number, worktree?: string): FolderActivity =>
  ({ directory, worktree, sessions, lastActive });

test('worktrees roll up into their project, newest activity first', () => {
  const suggestions = suggestProjects([
    row('/code/shop', 3, 100, '/code/shop'),
    row('/code/shop.worktrees/fix-cart', 2, 400),
    row('/Users/ana/.local/share/opencode/worktree/abc/brave-fox', 1, 300, '/code/shop'),
    row('/code/blog', 5, 200, '/code/blog')
  ], { projects: [] });
  assert.deepStrictEqual(suggestions, [
    { path: '/code/shop', name: 'shop', sessions: 6, lastActive: 400 },
    { path: '/code/blog', name: 'blog', sessions: 5, lastActive: 200 }
  ]);
});

test('home, the filesystem root and folders already on the board are not suggested', () => {
  const suggestions = suggestProjects([
    row('/Users/ana', 9, 900, '/'),
    row('/', 1, 800, '/'),
    row('/code/shop/packages/api', 2, 700),
    row('/code/notes', 1, 600, '/')
  ], { projects: [mine], home: '/Users/ana/' });
  assert.deepStrictEqual(suggestions.map((s) => s.path), ['/code/notes']);
});

test('gone folders are skipped and the list stops at the limit', () => {
  const checked: string[] = [];
  const suggestions = suggestProjects([
    row('/code/a', 1, 500),
    row('/code/gone', 1, 400),
    row('/code/b', 1, 300),
    row('/code/c', 1, 200)
  ], {
    projects: [],
    limit: 2,
    exists: (folder) => {
      checked.push(folder);
      return folder !== '/code/gone';
    }
  });
  assert.deepStrictEqual(suggestions.map((s) => s.path), ['/code/a', '/code/b']);
  assert.deepStrictEqual(checked, ['/code/a', '/code/gone', '/code/b']);
});
