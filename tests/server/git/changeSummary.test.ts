import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { summarizeTaskWorkspaces } from '../../../server/git/changeSummary.js';
import { TaskWorkspace } from '../../../shared/task/workspaces.js';

/**
 * Card summaries shell out to git. These repos are tiny and disposable; the
 * assertions are the counts a card renders, which have to survive the switch
 * off full patches.
 */

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@example.com'
};

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: gitEnv, stdio: 'pipe' });
}

function workspace(cwd: string): TaskWorkspace {
  return { cwd, label: path.basename(cwd), isWorktree: false, isTaskFolder: true, sessionIds: [] };
}

function tempRepo(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-summary-'));
  git(cwd, ['init', '-b', 'master']);
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\n');
  git(cwd, ['add', 'a.txt']);
  git(cwd, ['commit', '-m', 'base']);
  return cwd;
}

test('card summary reads numstat, untracked files and a clean branch', async (t) => {
  const cwd = tempRepo();
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  await t.test('a dirty tree counts the edit and the untracked file, and skips the branch', async () => {
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(cwd, 'b.txt'), 'u\nv\n');
    const summary = await summarizeTaskWorkspaces([workspace(cwd)]);
    assert.strictEqual(summary.scope, 'uncommitted');
    assert.strictEqual(summary.workspaces[0]?.stat.files, 2);
    assert.strictEqual(summary.workspaces[0]?.stat.additions, 3);
    assert.strictEqual(summary.workspaces[0]?.stat.deletions, 0);
    const untracked = summary.workspaces[0]?.files.find((file) => file.path === 'b.txt');
    assert.strictEqual(untracked?.status, 'added');
    assert.strictEqual(untracked?.additions, 2);
    assert.ok(!summary.workspaces[0]?.baseRef);
  });

  await t.test('a clean branch is compared with master', async () => {
    git(cwd, ['checkout', '-b', 'feature']);
    fs.writeFileSync(path.join(cwd, 'a.txt'), 'one\ntwo\n');
    git(cwd, ['add', 'a.txt']);
    git(cwd, ['commit', '-m', 'feature']);
    fs.rmSync(path.join(cwd, 'b.txt'), { force: true });
    const summary = await summarizeTaskWorkspaces([workspace(cwd)]);
    assert.strictEqual(summary.scope, 'branch');
    assert.strictEqual(summary.workspaces[0]?.baseRef, 'master');
    assert.strictEqual(summary.workspaces[0]?.branch, 'feature');
    assert.strictEqual(summary.workspaces[0]?.stat.files, 1);
    assert.strictEqual(summary.workspaces[0]?.stat.additions, 1);
  });

  await t.test('a missing folder is an error and not a git storm', async () => {
    const summary = await summarizeTaskWorkspaces([workspace(path.join(cwd, 'gone'))]);
    assert.strictEqual(summary.scope, 'uncommitted');
    assert.match(summary.workspaces[0]?.error || '', /no longer exists/);
    assert.strictEqual(summary.workspaces[0]?.stat.files, 0);
  });

  await t.test('two callers of one folder share the read', async () => {
    const [first, second] = await Promise.all([
      summarizeTaskWorkspaces([workspace(cwd)]),
      summarizeTaskWorkspaces([workspace(cwd)])
    ]);
    assert.deepStrictEqual(first.workspaces[0]?.stat, second.workspaces[0]?.stat);
    assert.strictEqual(first.scope, second.scope);
  });
});
