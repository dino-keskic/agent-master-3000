import test from 'node:test';
import assert from 'node:assert';
import { filterSessions, matchesTab, sessionTabCounts, sortSessions } from '../../../shared/sessions/import.js';
import { AcpSessionSummary } from '../../../shared/sessions/types.js';

const NOW = Date.parse('2026-03-18T12:00:00Z');
const TODAY = '2026-03-18T09:00:00Z';
const LAST_MONTH = '2026-02-10T09:00:00Z';

function session(overrides: Partial<AcpSessionSummary> & { sessionId: string }): AcpSessionSummary {
  return {
    title: 'A session',
    cwd: '/repo',
    updatedAt: LAST_MONTH,
    ...overrides
  };
}

test('the import tabs', async (t) => {
  const worked = session({ sessionId: 'ses_worked', updatedAt: TODAY, tokenCount: 900 });
  const dirty = session({ sessionId: 'ses_dirty', cwdDirty: true });
  const worktree = session({ sessionId: 'ses_tree', isWorktree: true, worktreeLabel: 'feat/x' });
  const changed = session({
    sessionId: 'ses_changed',
    changeSummary: { files: 2, additions: 10, deletions: 3 }
  });
  const onBoard = session({ sessionId: 'ses_done', importedAsTaskId: 'TASK-101', updatedAt: TODAY, tokenCount: 900 });
  const all = [worked, dirty, worktree, changed, onBoard];

  await t.test('everything shows on the All tab', () => {
    assert.deepEqual(filterSessions(all, 'all', NOW).map((s) => s.sessionId), all.map((s) => s.sessionId));
  });

  await t.test('uncommitted work is live whatever week it is from', () => {
    assert.equal(matchesTab(dirty, 'live', NOW), true);
  });

  await t.test('a session already on the board is not live', () => {
    assert.equal(matchesTab(onBoard, 'live', NOW), false);
    assert.equal(matchesTab(onBoard, 'imported', NOW), true);
    assert.equal(matchesTab(onBoard, 'unimported', NOW), false);
  });

  await t.test('a session with no diff and no dirty files is not "with changes"', () => {
    assert.equal(matchesTab(worked, 'diff', NOW), false);
    assert.equal(matchesTab(changed, 'diff', NOW), true);
    assert.equal(matchesTab(dirty, 'diff', NOW), true);
  });

  await t.test('the counts match what each tab would show', () => {
    const counts = sessionTabCounts(all, NOW);
    assert.equal(counts.all, 5);
    assert.equal(counts.live, 2);
    assert.equal(counts.worktrees, 1);
    assert.equal(counts.diff, 2);
    assert.equal(counts.unimported, 4);
    assert.equal(counts.imported, 1);
  });
});

test('the import sort orders', async (t) => {
  const sessions = [
    session({ sessionId: 'a', updatedAt: LAST_MONTH, tokenCount: 100, cost: 3 }),
    session({ sessionId: 'b', updatedAt: TODAY, tokenCount: 50, cost: 1, cwdDirty: true }),
    session({
      sessionId: 'c',
      updatedAt: '2026-03-01T00:00:00Z',
      tokenCount: 900,
      cost: 2,
      changeSummary: { files: 9, additions: 100, deletions: 20 }
    })
  ];

  await t.test('recent puts the newest first', () => {
    assert.deepEqual(sortSessions(sessions, 'recent').map((s) => s.sessionId), ['b', 'c', 'a']);
  });

  await t.test('tokens and cost each order by their own number', () => {
    assert.deepEqual(sortSessions(sessions, 'tokens').map((s) => s.sessionId), ['c', 'a', 'b']);
    assert.deepEqual(sortSessions(sessions, 'cost').map((s) => s.sessionId), ['a', 'c', 'b']);
  });

  await t.test('changes counts uncommitted work, not only the diff', () => {
    assert.deepEqual(sortSessions(sessions, 'changes').map((s) => s.sessionId), ['c', 'b', 'a']);
  });

  await t.test('sorting leaves the caller\'s list alone', () => {
    const before = sessions.map((s) => s.sessionId);
    sortSessions(sessions, 'cost');
    assert.deepEqual(sessions.map((s) => s.sessionId), before);
  });
});
