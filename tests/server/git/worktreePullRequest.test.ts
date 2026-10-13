import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createTaskWorktree } from '../../../server/git/worktree.js';

/**
 * A worktree for a pull request checks out the PR's branch, against real git
 * repositories. The clone's `origin` says `github.com/acme/web-app` and an
 * `insteadOf` sends it to a local bare repo, so the remote is recognised as
 * the PR's without anything leaving the machine.
 */

const run = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wt-pr-'));
  const seed = path.join(dir, 'seed');
  const origin = path.join(dir, 'origin.git');
  fs.mkdirSync(seed);
  run(seed, ['init', '-b', 'master']);
  run(seed, ['config', 'user.email', 'test@example.com']);
  run(seed, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(seed, 'README.md'), 'one');
  run(seed, ['add', '.']);
  run(seed, ['commit', '-m', 'one']);
  run(seed, ['checkout', '-b', 'fix/plan-editor-cap']);
  fs.writeFileSync(path.join(seed, 'cap.txt'), 'pr');
  run(seed, ['add', '.']);
  run(seed, ['commit', '-m', 'the PR']);
  const prTip = run(seed, ['rev-parse', 'HEAD']);
  run(dir, ['clone', '--bare', seed, origin]);
  // What GitHub serves for a fork's PR: the head under refs/pull, no branch.
  run(origin, ['update-ref', 'refs/pull/12/head', prTip]);
  run(origin, ['branch', '-D', 'fix/plan-editor-cap']);
  run(origin, ['update-ref', 'refs/heads/fix/plan-editor-cap', prTip]);

  const work = path.join(dir, 'work');
  run(dir, ['clone', '--branch', 'master', origin, work]);
  run(work, ['remote', 'set-url', 'origin', 'https://github.com/acme/web-app.git']);
  run(work, ['config', `url.${origin}.insteadOf`, 'https://github.com/acme/web-app.git']);
  return { dir, work, prTip };
}

test("a pull request's worktree is its branch, tracking the remote", async () => {
  const { dir, work, prTip } = setup();
  const pullRequest = { repo: 'acme/web-app', number: 9404, branch: 'fix/plan-editor-cap' };

  const created = await createTaskWorktree(work, { name: 'review it', pullRequest });
  assert.strictEqual(created.branch, 'fix/plan-editor-cap');
  assert.strictEqual(created.name, 'fix-plan-editor-cap');
  assert.strictEqual(created.pullRequest, 9404);
  assert.strictEqual(created.existing, undefined);
  assert.strictEqual(run(created.path, ['rev-parse', 'HEAD']), prTip);
  assert.strictEqual(run(created.path, ['rev-parse', '--abbrev-ref', '@{upstream}']), 'origin/fix/plan-editor-cap');

  // Asked again, the branch already has a checkout — that one is the answer.
  const again = await createTaskWorktree(work, { name: 'review it', pullRequest });
  assert.strictEqual(again.existing, true);
  assert.strictEqual(again.path, created.path);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a local branch is checked out as it is, and a fork's is kept under its owner", async () => {
  const { dir, work, prTip } = setup();
  run(work, ['branch', 'fix/plan-editor-cap', 'master']);
  const local = run(work, ['rev-parse', 'master']);
  const mine = await createTaskWorktree(work, {
    pullRequest: { repo: 'acme/web-app', number: 9404, branch: 'fix/plan-editor-cap' }
  });
  // Unpushed work may be on it, so it is not reset to the remote.
  assert.strictEqual(run(mine.path, ['rev-parse', 'HEAD']), local);

  const fork = await createTaskWorktree(work, {
    pullRequest: { repo: 'acme/web-app', number: 12, branch: 'master', forkOwner: 'ada-l' }
  });
  assert.strictEqual(fork.branch, 'ada-l/master');
  assert.strictEqual(fork.name, 'ada-l-master');
  assert.strictEqual(run(fork.path, ['rev-parse', 'HEAD']), prTip);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a pull request this checkout cannot reach gets a new branch named after it', async () => {
  const { dir, work } = setup();
  const elsewhere = await createTaskWorktree(work, {
    ticket: { ref: 'acme/other#7', kind: 'pr' },
    pullRequest: { repo: 'acme/other', number: 7, branch: 'fix/plan-editor-cap' }
  });
  assert.strictEqual(elsewhere.branch, 'acp/pr-7');
  assert.strictEqual(elsewhere.pullRequest, undefined);

  const gone = await createTaskWorktree(work, {
    ticket: { ref: 'acme/web-app#8', kind: 'pr' },
    pullRequest: { repo: 'acme/web-app', number: 8, branch: 'deleted/after-merge' }
  });
  assert.strictEqual(gone.branch, 'acp/pr-8');

  fs.rmSync(dir, { recursive: true, force: true });
});
