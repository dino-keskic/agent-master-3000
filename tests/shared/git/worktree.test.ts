import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  parseGitPorcelain,
  parseWorktreeList,
  ticketSlug,
  worktreeBranch,
  worktreeName,
  worktreePath,
  worktreeSlug
} from '../../../shared/git/worktree.js';
import { taskTicket, ticketInText } from '../../../shared/task/links.js';
import { TaskLink } from '../../../shared/types.js';
import { createTaskWorktree, gitInfo, listWorktrees } from '../../../server/git/worktree.js';

test('worktree slug and git worktree create', async (t) => {
  await t.test('worktreeSlug strips urls and punctuation', () => {
    assert.strictEqual(worktreeSlug('Fix the navbar overflow on mobile'), 'fix-the-navbar-overflow-on-mobile');
    assert.strictEqual(
      worktreeSlug('https://github.com/acme/web-app/pull/9041 please address comments'),
      'please-address-comments'
    );
    assert.strictEqual(worktreeSlug('   '), 'task');
    assert.strictEqual(worktreeBranch('fix-navbar'), 'acp/fix-navbar');
    assert.strictEqual(worktreePath('/src/web-app/', 'foo'), '/src/web-app/.worktrees/foo');
    assert.deepStrictEqual(
      parseGitPorcelain(' M lib/foo.dart\nA  lib/bar.dart\nR  old.dart -> new.dart\n'),
      ['lib/foo.dart', 'lib/bar.dart', 'new.dart']
    );
  });

  await t.test('parseWorktreeList reads the porcelain records', () => {
    const out = [
      'worktree /src/web-app',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/master',
      '',
      'worktree /src/web-app.worktrees/fix-navbar',
      'HEAD 2222222222222222222222222222222222222222',
      'branch refs/heads/acp/fix-navbar',
      '',
      'worktree /src/web-app.worktrees/spike',
      'HEAD 3333333333333333333333333333333333333333',
      'detached',
      'prunable gitdir file points to non-existent location',
      ''
    ].join('\n');

    assert.deepStrictEqual(parseWorktreeList(out), [
      {
        path: '/src/web-app',
        head: '1111111111111111111111111111111111111111',
        branch: 'master',
        detached: false,
        bare: false,
        prunable: false
      },
      {
        path: '/src/web-app.worktrees/fix-navbar',
        head: '2222222222222222222222222222222222222222',
        branch: 'acp/fix-navbar',
        detached: false,
        bare: false,
        prunable: false
      },
      {
        path: '/src/web-app.worktrees/spike',
        head: '3333333333333333333333333333333333333333',
        detached: true,
        bare: false,
        prunable: true
      }
    ]);
  });

  await t.test('parseWorktreeList handles bare repos, trimmed output and junk', () => {
    assert.deepStrictEqual(parseWorktreeList('worktree /src/bare.git\nbare'), [
      { path: '/src/bare.git', detached: false, bare: true, prunable: false }
    ]);
    assert.deepStrictEqual(parseWorktreeList(''), []);
    // Fields before the first `worktree` line belong to no record and are dropped.
    assert.deepStrictEqual(parseWorktreeList('HEAD abc\nbranch refs/heads/main'), []);
  });

  await t.test('a ticket names the worktree, and only a real one does', () => {
    assert.strictEqual(ticketSlug('WEB-1234'), 'web-1234');
    assert.strictEqual(ticketSlug('acme/web-app#9404'), 'issue-9404');
    assert.strictEqual(ticketSlug('acme/web-app#9041', 'pr'), 'pr-9041');
    assert.strictEqual(ticketSlug('  '), undefined);
    // The ticket beats the prose; without one the prose is all there is.
    assert.strictEqual(worktreeName({ ref: 'WEB-1234' }, 'Fix navbar overflow'), 'web-1234');
    assert.strictEqual(worktreeName(undefined, 'Fix navbar overflow'), 'fix-navbar-overflow');
    assert.strictEqual(worktreeName({}, ''), 'task');
  });

  await t.test('the ticket comes from the task links, or from the text', () => {
    const link = (kind: TaskLink['kind'], ref: string): TaskLink => ({
      id: ref, url: `https://example.com/${ref}`, title: ref, kind, ref, source: 'user', createdAt: 1
    });
    // A PR is what the work produced — the ticket it implements names it.
    assert.deepStrictEqual(
      taskTicket([link('pr', 'acme/web-app#9041'), link('jira', 'WEB-1234')]),
      { ref: 'WEB-1234', kind: 'jira' }
    );
    assert.strictEqual(taskTicket([{ ...link('doc', 'x'), kind: 'doc' }]), undefined);
    assert.deepStrictEqual(
      ticketInText('please look at https://acme.atlassian.net/browse/WEB-1234 today'),
      { ref: 'WEB-1234', kind: 'jira' }
    );
    assert.deepStrictEqual(ticketInText('WEB-1234 login loops'), { ref: 'WEB-1234', kind: 'jira' });
    // Only at the start: mid-sentence the shape is as likely to be an encoding.
    assert.strictEqual(ticketInText('write the file as UTF-8 please'), undefined);
  });

  await t.test('a new branch starts from the refreshed base, not from a stale checkout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wt-remote-'));
    const origin = path.join(dir, 'origin');
    const run = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    fs.mkdirSync(origin);
    run(origin, ['init', '-b', 'master']);
    run(origin, ['config', 'user.email', 'test@example.com']);
    run(origin, ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(origin, 'README.md'), 'one');
    run(origin, ['add', '.']);
    run(origin, ['commit', '-m', 'one']);

    const work = path.join(dir, 'work');
    run(dir, ['clone', origin, work]);
    const stale = run(work, ['rev-parse', 'HEAD']);

    // Somebody else pushes while this checkout sits where it was cloned.
    fs.writeFileSync(path.join(origin, 'README.md'), 'two');
    run(origin, ['commit', '-am', 'two']);
    const tip = run(origin, ['rev-parse', 'HEAD']);

    const created = await createTaskWorktree(work, { ticket: { ref: 'WEB-1', kind: 'jira' } });
    assert.strictEqual(created.base, 'master');
    assert.strictEqual(created.baseUpdated, true);
    assert.strictEqual(run(created.path, ['rev-parse', 'HEAD']), tip);
    // The checkout the user is looking at is left exactly where it was.
    assert.strictEqual(run(work, ['rev-parse', 'HEAD']), stale);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('gitInfo reports a repo and createTaskWorktree adds a folder inside it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-wt-'));
    execFileSync('git', ['init', '-b', 'master'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), 'hi');
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root });

    const info = await gitInfo(root);
    assert.strictEqual(info.isRepo, true);
    assert.strictEqual(info.branch, 'master');

    const created = await createTaskWorktree(root, { name: 'Fix navbar overflow' });
    assert.strictEqual(created.branch, 'acp/fix-navbar-overflow');
    assert.strictEqual(created.path, path.join(created.root, '.worktrees', 'fix-navbar-overflow'));
    // Inside the repo, so it must not show up as something to commit.
    assert.match(fs.readFileSync(path.join(root, '.git', 'info', 'exclude'), 'utf8'), /^\/\.worktrees\/$/m);
    assert.strictEqual(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '');
    assert.ok(fs.existsSync(created.path));
    assert.ok(fs.existsSync(path.join(created.path, 'README.md')));

    const ticketed = await createTaskWorktree(root, { name: 'Fix navbar overflow', ticket: { ref: 'WEB-1234', kind: 'jira' } });
    assert.strictEqual(ticketed.branch, 'acp/web-1234');
    assert.strictEqual(ticketed.name, 'web-1234');

    const second = await createTaskWorktree(root, { name: 'Fix navbar overflow' });
    assert.strictEqual(second.branch, 'acp/fix-navbar-overflow-2');
    assert.ok(fs.existsSync(second.path));

    const list = await listWorktrees(root);
    assert.strictEqual(list.length, 4);
    assert.strictEqual(list[0]?.branch, 'master');
    assert.deepStrictEqual(
      list.slice(1).map(w => w.branch).sort(),
      ['acp/fix-navbar-overflow', 'acp/fix-navbar-overflow-2', 'acp/web-1234']
    );

    const outside = await gitInfo(os.tmpdir());
    assert.strictEqual(outside.isRepo, false);
    assert.deepStrictEqual(await listWorktrees(os.tmpdir()), []);

    fs.rmSync(root, { recursive: true, force: true });
  });
});
