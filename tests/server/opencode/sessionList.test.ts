import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { compareSessionOrder, isLiveSession, pickLiveSessions, previewLines, weekStartMs } from '../../../shared/sessions/list.js';
import { activeRootSessionIds } from '../../../server/opencode/liveTurns.js';
import { worktreeLabel } from '../../../server/opencode/projects.js';
import { listOpenCodeSessions } from '../../../server/opencode/sessionList.js';
import { findRootSessionId, listChildSessionIds, listChildSessions } from '../../../server/opencode/subagents.js';
import { AcpSessionSummary } from '../../../shared/sessions/types.js';
import { DAY, NOW, makeFixture } from '../../fixtures/opencodeDb.js';

test('OpenCode session listing', async (t) => {
  const { file, live, dead, root } = makeFixture();
  process.env.OPENCODE_DB = file;

  await t.test('worktreeLabel detects sibling and OpenCode worktrees', () => {
    assert.strictEqual(worktreeLabel(live, live), undefined);
    assert.strictEqual(worktreeLabel(dead, live), 'feature-x');
    assert.strictEqual(
      worktreeLabel('/home/.local/share/opencode/worktree/proj-spa/agile-narwhal', live),
      'agile-narwhal'
    );
    assert.ok(worktreeLabel(dead, live));
    assert.strictEqual(worktreeLabel(live, live), undefined);
  });

  await t.test('old diffs do not outrank recent work; gone worktrees are hidden', async () => {
    const listed = await listOpenCodeSessions({ cwd: live });
    const ids = listed.sessions.map(s => s.sessionId);

    assert.ok(!ids.includes('ses-subagent'));
    const parent = listed.sessions.find(s => s.sessionId === 'ses-diff-yesterday');
    assert.strictEqual(parent?.cost, 16.4);
    assert.strictEqual(parent?.subagentCount, 2);
    assert.deepStrictEqual(listChildSessionIds('ses-diff-yesterday'), ['ses-subagent', 'ses-sub-subagent']);
    assert.strictEqual(findRootSessionId('ses-sub-subagent'), 'ses-diff-yesterday');
    const liveNow = activeRootSessionIds(['ses-diff-yesterday', 'ses-diff-old-live'], NOW);
    assert.ok(liveNow.has('ses-diff-yesterday'), 'live subagent activity marks the parent running');
    assert.ok(!liveNow.has('ses-diff-old-live'));
    assert.ok(!ids.includes('ses-untitled'));
    assert.ok(!ids.includes('ses-diff-old-dead'), 'deleted worktree sessions are not relevant');
    assert.ok(ids.includes('ses-chat-today'));
    assert.ok(ids.includes('ses-diff-yesterday'));
    assert.ok(ids.includes('ses-diff-old-live'));

    // Same week: longer session before empty daily. Older week (even 5M tokens) stays below.
    assert.deepStrictEqual(ids, [
      'ses-diff-yesterday',
      'ses-chat-today',
      'ses-diff-old-live'
    ]);

    const yesterday = listed.sessions.find(s => s.sessionId === 'ses-diff-yesterday');
    assert.strictEqual(yesterday?.cwdExists, true);
    assert.strictEqual(yesterday?.contextTokens, 175339, 'walks back past the 0-token trailing assistant message');
  });

  await t.test('listChildSessions returns a nested tree of direct children', () => {
    const tree = listChildSessions('ses-diff-yesterday');
    assert.strictEqual(tree.length, 1);
    const child = tree[0]!;
    assert.strictEqual(child.sessionId, 'ses-subagent');
    assert.strictEqual(child.parentId, 'ses-diff-yesterday');
    assert.strictEqual(child.title, 'Review PR (@coderabbit-code-reviewer subagent)');
    assert.strictEqual(child.children.length, 1);
    const nested = child.children[0]!;
    assert.strictEqual(nested.sessionId, 'ses-sub-subagent');
    assert.strictEqual(nested.parentId, 'ses-subagent');
    assert.strictEqual(nested.title, 'Nested worker subagent');
    assert.deepStrictEqual(nested.children, []);
    // Own spend per row; the parent's total with its children is kept apart,
    // so the tree does not print the nested child's cost twice.
    assert.strictEqual(child.cost, 3.6);
    assert.strictEqual(child.treeCost, 4);
    assert.strictEqual(nested.cost, 0.4);
    assert.strictEqual(nested.treeCost, undefined);
    assert.deepStrictEqual(listChildSessions('no-such-session'), []);
    assert.deepStrictEqual(listChildSessions(''), []);
  });

  await t.test('includeRemoved surfaces gone worktrees below live folders', async () => {
    const listed = await listOpenCodeSessions({ cwd: live, includeRemoved: true });
    const ids = listed.sessions.map(s => s.sessionId);
    assert.ok(ids.includes('ses-diff-old-dead'));
    assert.strictEqual(ids[ids.length - 1], 'ses-diff-old-dead');
    const deadSession = listed.sessions.find(s => s.sessionId === 'ses-diff-old-dead');
    assert.strictEqual(deadSession?.cwdExists, false);
    assert.strictEqual(deadSession?.isWorktree, true);
  });

  await t.test('compareSessionOrder: week, then uncommitted, then tokens', () => {
    const summary = (partial: Partial<AcpSessionSummary>): AcpSessionSummary => ({
      sessionId: 'x',
      title: 't',
      cwd: '/repo',
      updatedAt: new Date(NOW).toISOString(),
      ...partial
    });
    const daily = summary({ sessionId: 'daily', tokenCount: 0, cwdExists: true });
    const long = summary({ sessionId: 'long', tokenCount: 800_000, cwdExists: true, updatedAt: new Date(NOW - DAY).toISOString() });
    const dirty = summary({ sessionId: 'dirty', tokenCount: 1_000, cwdExists: true, cwdDirty: true, updatedAt: new Date(NOW - DAY).toISOString() });
    const lastWeekLong = summary({ sessionId: 'old', tokenCount: 9_000_000, cwdExists: true, updatedAt: new Date(NOW - 10 * DAY).toISOString() });
    const gone = summary({ sessionId: 'gone', tokenCount: 9_000_000, cwdExists: false, updatedAt: new Date(NOW).toISOString() });

    const ordered = [daily, lastWeekLong, long, gone, dirty].sort(compareSessionOrder).map(s => s.sessionId);
    assert.deepStrictEqual(ordered, ['dirty', 'long', 'daily', 'old', 'gone']);
    assert.ok(weekStartMs(NOW) > weekStartMs(NOW - 10 * DAY));
  });

  await t.test('search still finds live history only by default', async () => {
    const listed = await listOpenCodeSessions({ cwd: live, query: 'navbar' });
    assert.strictEqual(listed.sessions.length, 1);
    assert.strictEqual(listed.sessions[0]!.sessionId, 'ses-diff-yesterday');
    const gone = await listOpenCodeSessions({ cwd: live, query: 'Huge PR' });
    assert.strictEqual(gone.sessions.length, 0);
  });

  await t.test('isLiveSession is uncommitted or this-week work, never gone or empty daily', () => {
    const summary = (partial: Partial<AcpSessionSummary>): AcpSessionSummary => ({
      sessionId: 'x',
      title: 't',
      cwd: '/repo',
      updatedAt: new Date(NOW).toISOString(),
      cwdExists: true,
      ...partial
    });
    assert.strictEqual(isLiveSession(summary({ cwdDirty: true, tokenCount: 0 }), NOW), true);
    assert.strictEqual(isLiveSession(summary({ cwdDirty: true, updatedAt: new Date(NOW - 10 * DAY).toISOString() }), NOW), true);
    assert.strictEqual(isLiveSession(summary({ tokenCount: 80_000 }), NOW), true);
    assert.strictEqual(isLiveSession(summary({ title: 'Daily Status Sync', tokenCount: 0 }), NOW), false);
    assert.strictEqual(isLiveSession(summary({ tokenCount: 80_000, updatedAt: new Date(NOW - 10 * DAY).toISOString() }), NOW), false);
    assert.strictEqual(isLiveSession(summary({ cwdExists: false, cwdDirty: true, tokenCount: 9_000_000 }), NOW), false);
    assert.strictEqual(isLiveSession(summary({ tokenCount: 80_000, importedAsTaskId: 'TASK-1' }), NOW), false);

    const picked = pickLiveSessions([
      summary({ sessionId: 'daily', tokenCount: 0 }),
      summary({ sessionId: 'long', tokenCount: 80_000 }),
      summary({ sessionId: 'this-week-short', tokenCount: 640 }),
      summary({ sessionId: 'dirty-old', cwdDirty: true, tokenCount: 1_000, updatedAt: new Date(NOW - 10 * DAY).toISOString() }),
      summary({ sessionId: 'old', tokenCount: 9_000_000, updatedAt: new Date(NOW - 10 * DAY).toISOString() })
    ], 8, NOW).map(s => s.sessionId);
    assert.deepStrictEqual(picked, ['dirty-old', 'long', 'this-week-short']);
  });

  await t.test('previewLines hides a You line that duplicates the title', () => {
    const lines = previewLines({
      title: 'Please fix the navbar overflow',
      prompt: 'Please fix the navbar overflow',
      lastUserMessage: 'Please fix the navbar overflow',
      lastMessage: 'Done.'
    });
    assert.strictEqual(lines.user, undefined);
    assert.strictEqual(lines.agent, 'Done.');
  });

  await t.test('lists sessions from every board project, not only one cwd', async () => {
    const other = path.join(root, 'ml-backend');
    fs.mkdirSync(other, { recursive: true });
    const db = new DatabaseSync(file);
    db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, 1, 1, '[]')`)
      .run('proj-ml', other);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent)
      VALUES (?, 'proj-ml', NULL, ?, 'Train ranking model', 1, ?, 1, 4, 0, 'Local')
    `).run('ses-ml', other, NOW - 2 * 60 * 60 * 1000);
    db.close();

    const listed = await listOpenCodeSessions({
      projects: [
        { name: 'web-app', path: live },
        { name: 'ml-backend', path: other }
      ]
    });
    const ids = listed.sessions.map(s => s.sessionId);
    assert.ok(ids.includes('ses-chat-today'));
    assert.ok(ids.includes('ses-ml'));
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.OPENCODE_DB;
});
