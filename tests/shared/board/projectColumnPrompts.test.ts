import test from 'node:test';
import assert from 'node:assert';
import {
  effectiveColumnPrompt,
  projectColumnPrompt,
  projectsWithColumnPrompt,
  pruneColumnPrompts,
  resolveProjectRunPrompt,
  sameColumnPrompts,
  sanitizeColumnPrompts,
  setColumnPrompt
} from '../../../shared/board/projectColumnPrompts.js';
import { BoardColumn, ProjectFolder } from '../../../shared/types.js';

const review: BoardColumn = {
  id: 'review',
  title: 'Review',
  prompt: 'Review the work in this conversation.\n\n{{prompt}}',
  autoRun: true
};

function project(overrides: Partial<ProjectFolder> = {}): ProjectFolder {
  return {
    id: 'proj-1',
    name: 'agent-master-3000',
    path: '/repos/agent-master-3000',
    createdAt: 0,
    ...overrides
  };
}

const task = { title: 'Auth', prompt: 'Add JWT', cwd: '/repos/agent-master-3000', projectId: 'proj-1' };

test('projectColumnPrompts', async (t) => {
  await t.test('reads a project\'s instructions for one column, trimmed', () => {
    const p = project({ columnPrompts: { review: '  run npm test  ', plan: 'read AGENTS.md' } });
    assert.strictEqual(projectColumnPrompt(p, 'review'), 'run npm test');
    assert.strictEqual(projectColumnPrompt(p, 'deliver'), '');
    assert.strictEqual(projectColumnPrompt(undefined, 'review'), '');
    assert.strictEqual(projectColumnPrompt(p, undefined), '');
  });

  await t.test('lists the projects that have something to say about a column', () => {
    const projects = [
      project({ id: 'a', columnPrompts: { review: 'npm test' } }),
      project({ id: 'b', columnPrompts: { review: '   ' } }),
      project({ id: 'c' })
    ];
    assert.deepStrictEqual(projectsWithColumnPrompt(projects, 'review').map((p) => p.id), ['a']);
    assert.deepStrictEqual(projectsWithColumnPrompt(projects, 'plan'), []);
  });

  await t.test('clearing the box removes the entry rather than storing whitespace', () => {
    const set = setColumnPrompt({ plan: 'keep me' }, 'review', 'npm test');
    assert.deepStrictEqual(set, { plan: 'keep me', review: 'npm test' });
    assert.deepStrictEqual(setColumnPrompt(set, 'review', '   '), { plan: 'keep me' });
    assert.deepStrictEqual(setColumnPrompt(undefined, 'review', 'x'), { review: 'x' });
  });

  await t.test('pruning drops entries for columns the board no longer has', () => {
    const map = { review: 'npm test', gone: 'stale', blank: '  ' };
    assert.deepStrictEqual(pruneColumnPrompts(map, ['review', 'blank']), { review: 'npm test' });
    assert.deepStrictEqual(pruneColumnPrompts(undefined, ['review']), {});
  });

  await t.test('two maps compare equal when the blank entries are ignored', () => {
    assert.ok(sameColumnPrompts({ review: 'x' }, { review: 'x', plan: '  ' }));
    assert.ok(sameColumnPrompts(undefined, {}));
    assert.ok(!sameColumnPrompts({ review: 'x' }, { review: 'y' }));
    assert.ok(!sameColumnPrompts({ review: 'x' }, {}));
  });

  await t.test('sanitizes a map off the wire', () => {
    assert.deepStrictEqual(sanitizeColumnPrompts({ review: 'npm test', bad: 3, blank: ' ' }), { review: 'npm test' });
    assert.strictEqual(sanitizeColumnPrompts({}), undefined);
    assert.strictEqual(sanitizeColumnPrompts('nope'), undefined);
    assert.strictEqual(sanitizeColumnPrompts(['a']), undefined);
    assert.strictEqual(sanitizeColumnPrompts(null), undefined);
  });

  await t.test('composes the column prompt then the project instructions', () => {
    const p = project({ columnPrompts: { review: 'Run npm test and check AGENTS.md.' } });
    assert.strictEqual(
      effectiveColumnPrompt(review, p),
      'Review the work in this conversation.\n\n{{prompt}}\n\nRun npm test and check AGENTS.md.'
    );
  });

  await t.test('an empty side leaves the other one unchanged', () => {
    assert.strictEqual(effectiveColumnPrompt(review, project()), review.prompt);
    assert.strictEqual(effectiveColumnPrompt(review, project({ columnPrompts: { review: '   ' } })), review.prompt);
    assert.strictEqual(effectiveColumnPrompt(review, undefined), review.prompt);
  });

  await t.test('a move-only column stays move-only even with project instructions', () => {
    const backlog: BoardColumn = { id: 'backlog', title: 'Backlog', prompt: '  ', autoRun: false };
    const p = project({ columnPrompts: { backlog: 'never run this' } });
    assert.strictEqual(effectiveColumnPrompt(backlog, p), '');
    assert.strictEqual(effectiveColumnPrompt(undefined, p), '');
    assert.strictEqual(resolveProjectRunPrompt(backlog, task, [p]), undefined);
  });

  await t.test('resolves the run prompt for the task\'s own project', () => {
    const mine = project({ columnPrompts: { review: 'Run npm test.' } });
    const other = project({ id: 'proj-2', name: 'other', path: '/repos/other', columnPrompts: { review: 'Run pytest.' } });
    assert.strictEqual(
      resolveProjectRunPrompt(review, task, [other, mine]),
      'Review the work in this conversation.\n\nAdd JWT\n\nRun npm test.'
    );
  });

  await t.test('a sibling worktree still counts as the project', () => {
    const mine = project({ columnPrompts: { review: 'Run npm test.' } });
    const inWorktree = { ...task, cwd: '/repos/agent-master-3000.worktrees/feature-x', projectId: undefined };
    assert.ok(resolveProjectRunPrompt(review, inWorktree, [mine])?.endsWith('Run npm test.'));
  });

  await t.test('a task with no project, or an unknown one, gets the column prompt alone', () => {
    const mine = project({ columnPrompts: { review: 'Run npm test.' } });
    const orphan = { title: 'Auth', prompt: 'Add JWT' };
    const expected = 'Review the work in this conversation.\n\nAdd JWT';
    assert.strictEqual(resolveProjectRunPrompt(review, orphan, [mine]), expected);
    assert.strictEqual(resolveProjectRunPrompt(review, orphan, []), expected);
    assert.strictEqual(
      resolveProjectRunPrompt(review, { ...task, projectId: 'gone', cwd: '/elsewhere' }, [mine]),
      expected
    );
  });

  await t.test('project instructions can use the placeholders too', () => {
    const p = project({ columnPrompts: { review: 'The task was: {{title}}.' } });
    assert.ok(resolveProjectRunPrompt(review, task, [p])?.endsWith('The task was: Auth.'));
  });

  await t.test('an explicit follow-up wins over both halves', () => {
    const p = project({ columnPrompts: { review: 'Run npm test.' } });
    assert.strictEqual(resolveProjectRunPrompt(review, task, [p], '  just this  '), 'just this');
  });
});
