import test, { describe } from 'node:test';
import assert from 'node:assert';
import {
  ChangeFile,
  TaskChangeSummary,
  changeDetailLabel,
  changeScopeLabel,
  filesForCard,
  flagsForPath,
  formatChangeDigest,
  mergeChangeSummaries,
  summarizeChanges,
  toChangeFile,
  toWorkspaceChangeSummary,
  visibleChangeSummaries
} from '../../../shared/git/changeSummary.js';
import { DiffFile } from '../../../shared/git/diff.js';

function changeFile(overrides: Partial<ChangeFile> = {}): ChangeFile {
  return { path: 'src/app.ts', status: 'modified', additions: 3, deletions: 1, binary: false, ...overrides };
}

function summary(paths: ChangeFile[], scope: TaskChangeSummary['scope'] = 'uncommitted'): TaskChangeSummary {
  return {
    scope,
    workspaces: [
      {
        cwd: '/repo',
        label: 'repo',
        branch: 'feature/x',
        baseRef: 'main',
        stat: {
          files: paths.length,
          additions: paths.reduce((n, file) => n + file.additions, 0),
          deletions: paths.reduce((n, file) => n + file.deletions, 0)
        },
        files: paths,
        truncated: false
      }
    ]
  };
}

describe('Change file stripping', () => {
  test('1. Drops hunks but keeps counts and rename source', () => {
    const file: DiffFile = {
      path: 'new/name.ts',
      oldPath: 'old/name.ts',
      status: 'renamed',
      additions: 1,
      deletions: 2,
      binary: false,
      hunks: [{ header: '', oldStart: 1, newStart: 1, lines: [] }]
    };
    assert.deepStrictEqual(toChangeFile(file), {
      path: 'new/name.ts',
      oldPath: 'old/name.ts',
      status: 'renamed',
      additions: 1,
      deletions: 2,
      binary: false
    });
  });

  test('2. Omits oldPath when the file was not renamed', () => {
    const stripped = toChangeFile({
      path: 'a.ts',
      oldPath: 'a.ts',
      status: 'modified',
      additions: 0,
      deletions: 0,
      binary: false,
      hunks: []
    });
    assert.ok(!('oldPath' in stripped));
  });

  test('3. Workspace stripping carries branch, base and error', () => {
    const out = toWorkspaceChangeSummary(
      {
        branch: 'feature/x',
        baseRef: 'main',
        stat: { files: 1, additions: 1, deletions: 0 },
        files: [
          {
            path: 'a.ts',
            status: 'added',
            additions: 1,
            deletions: 0,
            binary: false,
            hunks: []
          }
        ],
        truncated: true,
        error: undefined
      },
      { cwd: '/repo', label: 'repo' }
    );
    assert.strictEqual(out.branch, 'feature/x');
    assert.strictEqual(out.baseRef, 'main');
    assert.strictEqual(out.truncated, true);
    assert.strictEqual(out.files.length, 1);
    assert.ok(!('error' in out));
  });
});

describe('Path flags', () => {
  test('4. Lockfiles flag as lockfile, never deps', () => {
    assert.deepStrictEqual(flagsForPath('package-lock.json'), ['lockfile']);
    assert.deepStrictEqual(flagsForPath('backend/Cargo.lock'), ['lockfile']);
  });

  test('5. Manifests and requirements files flag as deps', () => {
    assert.deepStrictEqual(flagsForPath('package.json'), ['deps']);
    assert.deepStrictEqual(flagsForPath('api/requirements-dev.txt'), ['deps']);
    assert.deepStrictEqual(flagsForPath('requirements.txt'), ['deps']);
  });

  test('6. Migration segments flag case-insensitively', () => {
    assert.deepStrictEqual(flagsForPath('db/migrate/001_add.ts'), ['migration']);
    assert.deepStrictEqual(flagsForPath('DB/MIGRATIONS/init.sql'), ['migration']);
  });

  test('7. Config, env, docker and CI paths flag', () => {
    assert.deepStrictEqual(flagsForPath('.env.production'), ['config']);
    assert.deepStrictEqual(flagsForPath('vite.config.ts'), ['config']);
    assert.deepStrictEqual(flagsForPath('Dockerfile'), ['config']);
    assert.deepStrictEqual(flagsForPath('.github/workflows/test.yml'), ['ci']);
    assert.deepStrictEqual(flagsForPath('.gitlab-ci.yml'), ['ci']);
  });

  test('8. Ordinary sources raise nothing, flags stay ordered', () => {
    assert.deepStrictEqual(flagsForPath('src/app.ts'), []);
    assert.deepStrictEqual(flagsForPath('.github/workflows/migrate-db.yml'), ['migration', 'ci']);
  });

  test('9. A capped file list keeps the flagged path', () => {
    const ordinary = (path: string): ChangeFile => ({ path, status: 'modified', additions: 1, deletions: 0, binary: false });
    const listed = filesForCard([ordinary('src/a.ts'), ordinary('src/b.ts'), ordinary('package-lock.json')], 2);
    assert.deepStrictEqual(listed.map((file) => file.path), ['package-lock.json', 'src/a.ts']);
  });
});

describe('Change digest', () => {
  test('9. Totals, statuses and flags roll up across folders', () => {
    const digest = summarizeChanges(
      summary([
        changeFile({ path: 'src/app.ts', additions: 10, deletions: 4 }),
        changeFile({ path: 'package-lock.json', status: 'modified', additions: 50, deletions: 50 }),
        changeFile({ path: 'NEW.md', status: 'added', additions: 3, deletions: 0 }),
        changeFile({ path: 'OLD.md', status: 'deleted', additions: 0, deletions: 9 })
      ])
    );
    assert.strictEqual(digest.files, 4);
    assert.strictEqual(digest.additions, 63);
    assert.strictEqual(digest.deletions, 63);
    assert.strictEqual(digest.added, 1);
    assert.strictEqual(digest.deleted, 1);
    assert.strictEqual(digest.renamed, 0);
    assert.deepStrictEqual(digest.flags, ['lockfile']);
  });

  test('10. Errored folders contribute nothing', () => {
    const broken: TaskChangeSummary = {
      scope: 'uncommitted',
      workspaces: [
        {
          cwd: '/gone',
          label: 'gone',
          stat: { files: 0, additions: 0, deletions: 0 },
          files: [],
          truncated: false,
          error: 'This folder no longer exists'
        }
      ]
    };
    assert.deepStrictEqual(summarizeChanges(broken), {
      files: 0,
      additions: 0,
      deletions: 0,
      added: 0,
      deleted: 0,
      renamed: 0,
      flags: []
    });
  });

  test('11. Formatting singularizes one file', () => {
    assert.strictEqual(
      formatChangeDigest(summarizeChanges(summary([changeFile({ additions: 1, deletions: 0 })]))),
      '+1 −0 · 1 file'
    );
    assert.strictEqual(
      formatChangeDigest(
        summarizeChanges(summary([changeFile({ additions: 128, deletions: 34 }), changeFile()]))
      ),
      '+131 −35 · 2 files'
    );
  });

  test('12. Detail label names only what stands out', () => {
    assert.strictEqual(changeDetailLabel(summarizeChanges(summary([changeFile()]))), undefined);
    assert.strictEqual(
      changeDetailLabel(
        summarizeChanges(
          summary([
            changeFile({ status: 'added' }),
            changeFile({ status: 'added' }),
            changeFile({ status: 'deleted' }),
            changeFile({ status: 'renamed' })
          ])
        )
      ),
      '2 new, 1 deleted, 1 renamed'
    );
  });

  test('13. Scope label says which tree the numbers came from', () => {
    assert.strictEqual(changeScopeLabel(summary([changeFile()])), 'Uncommitted changes');
    assert.strictEqual(
      changeScopeLabel(summary([changeFile()], 'branch')),
      'On feature/x vs main'
    );
    const noBase: TaskChangeSummary = {
      scope: 'branch',
      workspaces: [
        {
          cwd: '/repo',
          label: 'repo',
          branch: 'feature/x',
          stat: { files: 1, additions: 1, deletions: 0 },
          files: [changeFile()],
          truncated: false
        }
      ]
    };
    assert.strictEqual(changeScopeLabel(noBase), 'Committed on feature/x');
  });
});

describe('Summary merging', () => {
  test('14. Unchanged tasks keep their identity, changed ones swap', () => {
    const first = summary([changeFile({ additions: 1 })]);
    const prev = { 'TASK-1': first };
    const same = mergeChangeSummaries(prev, { 'TASK-1': summary([changeFile({ additions: 1 })]) });
    assert.strictEqual(same, prev);
    const next = mergeChangeSummaries(prev, { 'TASK-1': summary([changeFile({ additions: 2 })]) });
    assert.notStrictEqual(next, prev);
    assert.strictEqual(next['TASK-1']?.workspaces[0]?.stat.additions, 2);
  });

  test('15. Dropped tasks leave, new tasks join', () => {
    const prev = { 'TASK-1': summary([changeFile()]) };
    const next = mergeChangeSummaries(prev, {
      'TASK-2': summary([changeFile({ path: 'b.ts' })])
    });
    assert.deepStrictEqual(Object.keys(next), ['TASK-2']);
  });

  test('16. Visible prunes departed tasks, same reference when none left', () => {
    const held = { 'TASK-1': summary([changeFile()]), 'TASK-2': summary([changeFile()]) };
    assert.strictEqual(visibleChangeSummaries(held, ['TASK-1', 'TASK-2']), held);
    const pruned = visibleChangeSummaries(held, ['TASK-1']);
    assert.deepStrictEqual(Object.keys(pruned), ['TASK-1']);
    assert.strictEqual(pruned['TASK-1'], held['TASK-1']);
  });
});
