import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { boardSpend, taskSpend } from '../../../server/opencode/spend.js';
import { cloneOpenCodeSession } from '../../../server/opencode/clone.js';
import { OTHER_PROJECT } from '../../../shared/spend/summary.js';
import { ProjectFolder } from '../../../shared/types.js';
import { makeFixture, openCodeId } from '../../fixtures/opencodeDb.js';
import { link, task } from '../../fixtures/boardTasks.js';

/**
 * The spend reader against a real database, with a real fork.
 *
 * The pure summaries in `spend.test.ts` never saw what a fork leaves in the
 * message table — a second copy of every turn, same dates, same cost — so the
 * board-wide month counted a forked conversation once per copy and nothing
 * failed. This file reads it the way the header and the spend panel do.
 *
 * The turns are dated in 2025 because the clone stamps the fork's session with
 * the real clock: the fork is younger than the original, as in real use, and
 * its `time_updated` puts it inside the read. Costs are binary fractions so the
 * sums are exact.
 */

const { file, live, root } = makeFixture();
process.env.OPENCODE_DB = file;

/** Wednesday 18 June 2025, noon UTC. With en-GB the week began on Monday the 16th. */
const NOW = Date.UTC(2025, 5, 18, 12);
const LOCALE = 'en-GB';
const TZ = 'UTC';
const ORIGINAL = 'ses-original';
const projects: ProjectFolder[] = [{ id: 'p1', name: 'web-app', path: live, createdAt: 0 }];

const MAY = Date.UTC(2025, 4, 10, 12);
const MONDAY = Date.UTC(2025, 5, 16, 10);
const TUESDAY = Date.UTC(2025, 5, 17, 10);
/** The fork is made after Tuesday's turn and takes one of its own this morning. */
const FORKED_AT = Date.UTC(2025, 5, 18, 9);
const FORK_TURN = Date.UTC(2025, 5, 18, 11);

const db = new DatabaseSync(file);
// The shared fixture's own turns are not part of these sums.
db.exec('DELETE FROM message; DELETE FROM part;');
db.prepare(
  `INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated)
   VALUES (?, 'proj-spa', NULL, ?, 'Original', ?, ?)`
).run(ORIGINAL, live, MAY, TUESDAY);

function turn(sessionId: string, at: number, cost: number, counter = 1): void {
  const data = {
    role: 'assistant',
    time: { created: at, completed: at + 5_000 },
    cost,
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    providerID: 'github-copilot',
    modelID: 'grok-4.5',
    agent: 'build'
  };
  db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)').run(
    openCodeId('msg', at, counter),
    sessionId,
    at,
    at + 5_000,
    JSON.stringify(data)
  );
}

turn(ORIGINAL, MAY, 0.5);
turn(ORIGINAL, MONDAY, 0.25);
turn(ORIGINAL, TUESDAY, 0.125);

// Before the fork: June is Monday's and Tuesday's turns.
const before = boardSpend(projects, NOW, LOCALE, TZ);

// A handoff to a folder that is no project of the board's, then a turn there.
const handoff = path.join(root, 'elsewhere');
const fork = cloneOpenCodeSession(ORIGINAL, 'Moved', { directory: handoff });
if (!fork) throw new Error('clone failed');
turn(fork.sessionId, FORK_TURN, 0.0625, 2);

// A minute later, so the board cache has expired.
const after = boardSpend(projects, NOW + 61_000, LOCALE, TZ, { history: true });

test('the fixture is what the sums assume', () => {
  const copies = db.prepare('SELECT COUNT(*) AS n FROM message WHERE session_id = ?').get(fork.sessionId) as { n: number };
  assert.strictEqual(copies.n, 4, 'three copied turns plus the fork’s own');
  assert.strictEqual(before.month.cost, 0.375);
});

test('a fork adds only its own turns to the month, week and day', () => {
  assert.strictEqual(after.month.cost, 0.4375);
  assert.strictEqual(after.month.messages, 3);
  assert.strictEqual(after.month.sessions, 2);
  assert.strictEqual(after.week.cost, 0.4375);
  assert.strictEqual(after.today.cost, 0.0625);
  assert.strictEqual(after.daily.reduce((sum, day) => sum + day.cost, 0), 0.4375);
});

test('copied turns stay with the project and session that paid for them', () => {
  const byProject = Object.fromEntries(after.byProject.map((row) => [row.key, row.cost]));
  assert.deepEqual(byProject, { 'web-app': 0.375, [OTHER_PROJECT]: 0.0625 });

  const bySession = Object.fromEntries(after.topSessions.map((row) => [row.sessionId, row.cost]));
  assert.deepEqual(bySession, { [ORIGINAL]: 0.375, [fork.sessionId]: 0.0625 });

  assert.strictEqual(after.byModel.reduce((sum, row) => sum + row.cost, 0), 0.4375);
  assert.strictEqual(after.byAgent.reduce((sum, row) => sum + row.cost, 0), 0.4375);
});

test('past months count a forked conversation once', () => {
  const may = after.monthly.find((row) => row.month === '2025-05');
  assert.ok(may, 'May is in the history');
  assert.strictEqual(may.cost, 0.5);
  assert.strictEqual(may.days, 31);

  const current = after.monthly[after.monthly.length - 1]!;
  assert.strictEqual(current.month, '2025-06');
  assert.strictEqual(current.cost, 0.4375);
});

test('weekly history counts a forked conversation once', () => {
  const open = after.weekly[after.weekly.length - 1]!;
  assert.strictEqual(open.week, '2025-06-16');
  assert.strictEqual(open.partial, true);
  assert.strictEqual(open.cost, 0.4375);
  assert.strictEqual(after.weekly.reduce((sum, week) => sum + week.cost, 0), 0.9375);
});

test('a task bills a side chat for its own turns only', () => {
  const sideChat = task({
    id: 'TASK-FORK',
    sessionId: ORIGINAL,
    sessions: [
      link({ sessionId: ORIGINAL }),
      link({ sessionId: fork.sessionId, kind: 'btw', createdAt: FORKED_AT })
    ]
  });
  const spend = taskSpend(sideChat, [], NOW, { fresh: true });
  assert.strictEqual(spend.total, 0.9375);
  assert.deepEqual(
    spend.byPhase.map((row) => row.cost).sort(),
    [0.0625, 0.875]
  );
});

test('a copy that lost its fork marker is still not billed twice', () => {
  const unmarked = task({
    id: 'TASK-UNMARKED',
    sessionId: ORIGINAL,
    sessions: [link({ sessionId: ORIGINAL }), link({ sessionId: fork.sessionId })]
  });
  assert.strictEqual(taskSpend(unmarked, [], NOW, { fresh: true }).total, 0.9375);
});

test('without a fork, a task’s total is its session’s turns', () => {
  const plain = task({ id: 'TASK-PLAIN', sessionId: ORIGINAL, sessions: [link({ sessionId: ORIGINAL })] });
  assert.strictEqual(taskSpend(plain, [], NOW, { fresh: true }).total, 0.875);
});
