import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { closeReadDb } from '../../../server/opencode/db.js';
import { loadSessionHistory } from '../../../server/opencode/history.js';
import { adoptV1Session } from '../../../server/opencode/migrateV1.js';
import { getOpenCodeSession, listOpenCodeSessions } from '../../../server/opencode/sessionList.js';
import { listChildSessionIds } from '../../../server/opencode/subagents.js';
import { boardSpend } from '../../../server/opencode/spend.js';
import { cloneOpenCodeSession } from '../../../server/opencode/clone.js';
import { ROOT, V1_CHILD, V1_ONLY, V2_NOW, addUnmigratedV1, makeV2Fixture } from '../../fixtures/opencodeDbV2.js';

/**
 * Sessions OpenCode 2's migration never reached: read from the 1.x tables
 * beside the 2.x ones, and copied across when one is to be resumed.
 */

test('1.x sessions OpenCode 2 never migrated', async (t) => {
  const { file, dir: v2Dir } = makeV2Fixture();
  const { dir } = addUnmigratedV1(file);
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => closeReadDb());
  const projects = [
    { id: 'p1', name: 'web-app', path: v2Dir, createdAt: 0 },
    { id: 'p2', name: 'old-app', path: dir, createdAt: 0 }
  ];
  const spendOf = () => boardSpend(projects, V2_NOW + 1_000, 'en-US', 'UTC');
  const textsOf = (sessionId: string) => loadSessionHistory(sessionId).logs.map((l) => `${l.type}:${l.text ?? l.toolCall?.name ?? ''}`);

  let before: string[] = [];

  await t.test('are listed, read and costed beside the 2.x ones', async () => {
    assert.strictEqual(getOpenCodeSession(V1_ONLY)?.title, 'Old 1.x work');
    const listed = await listOpenCodeSessions({ cwd: dir });
    assert.deepStrictEqual(listed.sessions.map((s) => s.sessionId), [V1_ONLY]);
    assert.deepStrictEqual(listChildSessionIds(V1_ONLY), [V1_CHILD]);
    before = textsOf(V1_ONLY);
    assert.ok(before.includes('user_say:Rename the header'));
    assert.ok(before.includes('agent_say:Renamed.'));
    const spend = spendOf();
    assert.strictEqual(spend.month.cost, 0.75 + 2);
    assert.deepStrictEqual(spend.byProject.map((b) => [b.key, b.cost]).sort(), [['old-app', 2], ['web-app', 0.75]]);
  });

  await t.test('a migrated session still hides its stale 1.x copy', () => {
    assert.strictEqual(getOpenCodeSession(ROOT)?.title, 'Fix the build');
  });

  await t.test('resuming one copies its whole tree into the 2.x tables', () => {
    assert.deepStrictEqual(adoptV1Session(V1_CHILD), [V1_ONLY, V1_CHILD]);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const session = db.prepare('SELECT * FROM session_v2 WHERE id = ?').get(V1_ONLY) as any;
      assert.strictEqual(session.project_id, 'global', 'its project was gone');
      assert.strictEqual(session.title, 'Old 1.x work');
      assert.strictEqual(session.cost, 1.5);
      assert.strictEqual(session.tokens_input, 100);
      assert.strictEqual(session.tokens_cache_read, 10);
      assert.strictEqual(session.agent, 'build');
      assert.deepStrictEqual(JSON.parse(session.model), { id: 'm', providerID: 'stub', variant: 'default' });
      assert.strictEqual(session.time_updated, V2_NOW - 10_000 + 50);
      const rows = db.prepare('SELECT type, seq, data FROM session_message WHERE session_id = ? ORDER BY seq').all(V1_ONLY) as any[];
      assert.deepStrictEqual(rows.map((r) => [r.type, r.seq]), [['user', 0], ['assistant', 1], ['system', 2]]);
      const answer = JSON.parse(rows[1].data);
      assert.deepStrictEqual(answer.content.map((c: any) => c.name ?? c.type), ['reasoning', 'bash', 'task', 'text']);
      assert.deepStrictEqual(answer.snapshot, { start: 'aaa', end: 'bbb' });
      assert.match(JSON.parse(rows[2].data).text, /`bash` is now `shell`; `task` is now `subagent`/);
      const counter = db.prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?').get(V1_ONLY) as any;
      assert.strictEqual(counter.seq, 2);
      assert.strictEqual((db.prepare('SELECT parent_id FROM session_v2 WHERE id = ?').get(V1_CHILD) as any).parent_id, V1_ONLY);
    } finally {
      db.close();
    }
  });

  await t.test('and it reads and costs the same afterwards, once', () => {
    assert.deepStrictEqual(textsOf(V1_ONLY), before);
    assert.strictEqual(spendOf().month.cost, 0.75 + 2);
  });

  await t.test('a session 2.x already has is left alone', () => {
    assert.deepStrictEqual(adoptV1Session(V1_ONLY), []);
    assert.deepStrictEqual(adoptV1Session(ROOT), []);
    assert.deepStrictEqual(adoptV1Session('ses_nowhere'), []);
  });

  await t.test('a fork of a copied session carries its history', () => {
    const fork = cloneOpenCodeSession(V1_ONLY, 'Side chat');
    assert.ok(fork);
    assert.strictEqual(fork.costAtFork, 1.5);
  });
});

test('nothing is copied before OpenCode has begun its own migration', () => {
  const { file } = makeV2Fixture();
  addUnmigratedV1(file);
  const db = new DatabaseSync(file);
  db.prepare(`DELETE FROM kv WHERE key = 'migration.v1-v2'`).run();
  db.close();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  assert.deepStrictEqual(adoptV1Session(V1_ONLY), []);
  closeReadDb();
});
