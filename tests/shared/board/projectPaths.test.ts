import test from 'node:test';
import assert from 'node:assert';
import {
  folderInCheckouts,
  folderInProject,
  normalizeFolder,
  projectForFolder,
  projectOwning
} from '../../../shared/board/projectPaths.js';

const projects = [
  { id: 'p1', name: 'agent-master-3000', path: '/code/agent-master-3000' },
  { id: 'p2', name: 'web-app', path: '/code/web-app' },
  { id: 'p3', name: 'inner', path: '/code/agent-master-3000/packages/inner' }
];

test('trailing slashes never make two spellings of a folder differ', () => {
  assert.strictEqual(normalizeFolder('/code/agent-master-3000//'), '/code/agent-master-3000');
  assert.strictEqual(normalizeFolder(undefined), '');
  assert.ok(folderInProject('/code/agent-master-3000/', '/code/agent-master-3000'));
});

test('a folder is in a project when it is the root or under it', () => {
  assert.ok(folderInProject('/code/agent-master-3000', '/code/agent-master-3000'));
  assert.ok(folderInProject('/code/agent-master-3000/src', '/code/agent-master-3000'));
  assert.ok(!folderInProject('/code/agent-master-3000-old', '/code/agent-master-3000'));
  assert.ok(!folderInProject('/code', '/code/agent-master-3000'));
});

test("a project's sibling worktrees count as the project", () => {
  // Where a checkout made for the project lands, next to the repo rather than in it.
  assert.ok(folderInProject('/code/agent-master-3000.worktrees/feature-x', '/code/agent-master-3000'));
});

test('an empty folder or project path is nobody', () => {
  assert.ok(!folderInProject('', '/code/agent-master-3000'));
  assert.ok(!folderInProject('/code/agent-master-3000', ''));
});

test('the deepest root wins, so a nested project keeps its own folders', () => {
  assert.strictEqual(projectForFolder('/code/agent-master-3000/src', projects)?.id, 'p1');
  assert.strictEqual(projectForFolder('/code/agent-master-3000/packages/inner/src', projects)?.id, 'p3');
  assert.strictEqual(projectForFolder('/elsewhere', projects), undefined);
});

test('the folder answers before the tag, and the tag only when no folder does', () => {
  // A stale tag does not relabel work that plainly runs inside another project.
  assert.strictEqual(projectOwning(projects, 'p2', '/code/agent-master-3000/src')?.id, 'p1');
  assert.strictEqual(projectOwning(projects, 'p2', '/tmp/scratch')?.id, 'p2');
  assert.strictEqual(projectOwning(projects, undefined, '/tmp/scratch'), undefined);
  assert.strictEqual(projectOwning(projects, 'gone', '/tmp/scratch'), undefined);
});

test('a checkout git reports counts, wherever on disk it landed', () => {
  const checkouts = [
    '/src/spa-mobile',
    '/Users/dev/.local/share/opencode/worktree/abc123/feature-x',
    '/private/var/folders/T/opencode/wt-pr-9404/'
  ];
  assert.strictEqual(folderInCheckouts('/Users/dev/.local/share/opencode/worktree/abc123/feature-x', checkouts), true);
  // Inside a checkout is inside the project, the same as inside its root.
  assert.strictEqual(folderInCheckouts('/private/var/folders/T/opencode/wt-pr-9404/packages/app', checkouts), true);
  // A trailing slash is a spelling, not a different folder.
  assert.strictEqual(folderInCheckouts('/private/var/folders/T/opencode/wt-pr-9404', checkouts), true);
});

test('a folder that is merely next to a checkout is not in it', () => {
  const checkouts = ['/Users/dev/worktree/abc/feature-x'];
  assert.strictEqual(folderInCheckouts('/Users/dev/worktree/abc/feature-x-2', checkouts), false);
  assert.strictEqual(folderInCheckouts('/Users/dev/worktree/abc', checkouts), false);
});

test('nothing matches nothing', () => {
  assert.strictEqual(folderInCheckouts('/src/app', []), false);
  assert.strictEqual(folderInCheckouts('', ['/src/app']), false);
  assert.strictEqual(folderInCheckouts(undefined, ['/src/app']), false);
  assert.strictEqual(folderInCheckouts('/src/app', [undefined, '']), false);
});
