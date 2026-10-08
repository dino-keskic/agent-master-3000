import test from 'node:test';
import assert from 'node:assert';
import { DatabaseSync } from 'node:sqlite';
import { installV2Views, isV2Schema } from '../../../server/opencode/schemaV2.js';
import { closeReadDb } from '../../../server/opencode/db.js';
import { loadSessionHistory } from '../../../server/opencode/history.js';
import { getOpenCodeSession, listOpenCodeSessions } from '../../../server/opencode/sessionList.js';
import { activeRootSessionIds } from '../../../server/opencode/liveTurns.js';
import { findRootSessionId, listChildSessionIds, listChildSessions } from '../../../server/opencode/subagents.js';
import { cloneOpenCodeSession } from '../../../server/opencode/clone.js';
import { boardSpend } from '../../../server/opencode/spend.js';
import { catalogFromDb, loadModelCatalog } from '../../../server/opencode/models.js';
import { makeFixture } from '../../fixtures/opencodeDb.js';
import { CHILD, ROOT, RUNNING, V2_NOW, makeV2Fixture } from '../../fixtures/opencodeDbV2.js';

/**
 * The board's readers are written against OpenCode 1's tables. On a 2.x
 * database they read the views `schemaV2.ts` installs, so these tests drive the
 * same readers the 1.x tests do, over a 2.x layout with the frozen 1.x tables
 * still beside it.
 */

test('OpenCode 2 database', async (t) => {
  const { file, dir } = makeV2Fixture();
  closeReadDb();
  process.env.OPENCODE_DB = file;
  t.after(() => closeReadDb());

  await t.test('a 1.x database gets no views', () => {
    const v1 = new DatabaseSync(makeFixture().file, { readOnly: true });
    try {
      assert.strictEqual(isV2Schema(v1), false);
      assert.strictEqual(installV2Views(v1), false);
    } finally {
      v1.close();
    }
  });

  await t.test('the views shadow the tables a migration left behind', () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.strictEqual(installV2Views(db), true);
      const row = db.prepare('SELECT title, cost FROM session WHERE id = ?').get(ROOT) as any;
      assert.deepStrictEqual({ ...row }, { title: 'Fix the build', cost: 0.5 });
      const ids = (db.prepare('SELECT id FROM message WHERE session_id = ?').all(ROOT) as any[]).map((r) => r.id);
      assert.ok(!ids.includes('msg_stale'));
      assert.strictEqual(ids.length, 3, 'the idle row is not a message');
      // Installing twice on one connection is harmless.
      assert.strictEqual(installV2Views(db), true);
    } finally {
      db.close();
    }
  });

  await t.test('parts come out in the order they were written', () => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      installV2Views(db);
      const parts = db.prepare('SELECT data FROM part WHERE session_id = ? ORDER BY time_created, id').all(ROOT) as any[];
      const types = parts.map((p) => JSON.parse(p.data).type + ':' + (JSON.parse(p.data).tool ?? ''));
      assert.deepStrictEqual(types, ['text:', 'reasoning:', 'tool:shell', 'tool:subagent', 'tool:execute', 'text:']);
      const shell = JSON.parse(parts[2].data);
      assert.strictEqual(shell.state.output, 'built\n');
      assert.strictEqual(shell.state.time.start, V2_NOW - 84);
      assert.strictEqual(shell.state.time.end, V2_NOW - 70);
    } finally {
      db.close();
    }
  });

  await t.test('history reads prompts, thinking, tools and answers', () => {
    const history = loadSessionHistory(ROOT);
    const types = history.logs.map((l) => l.type);
    assert.deepStrictEqual(types, ['user_say', 'thought', 'tool_call', 'tool_call', 'tool_call', 'agent_say']);
    assert.strictEqual(history.logs[0]!.text, 'Please fix the build.');
    assert.strictEqual(history.logs[1]!.text, 'Check the compiler first.');
    assert.strictEqual(history.logs[2]!.toolCall?.status, 'completed');
    assert.strictEqual(history.logs[5]!.text, 'The build is green.');
    assert.strictEqual(history.logs[5]!.metadata?.model, 'stub/m');
    assert.strictEqual(history.logs[5]!.metadata?.agent, 'build');
    assert.ok(!history.logs.some((l) => l.text === 'stale prompt'));
  });

  await t.test('a Code Mode call keeps what it reported running', () => {
    const call = loadSessionHistory(ROOT).logs[4]!;
    assert.strictEqual(call.toolCall?.name, 'execute');
    assert.deepStrictEqual(call.toolCall?.codeModeCalls, ['echo-board.echo']);
  });

  await t.test('a subagent call links to the session it started', () => {
    const call = loadSessionHistory(ROOT).logs[3]!;
    assert.strictEqual(call.toolCall?.name, 'subagent');
    assert.strictEqual(call.toolCall?.subagentSessionId, CHILD);
  });

  await t.test('the session list finds the model in the answers', async () => {
    const summary = getOpenCodeSession(ROOT);
    assert.ok(summary);
    assert.strictEqual(summary.title, 'Fix the build');
    assert.strictEqual(summary.model, 'stub/m');
    assert.strictEqual(summary.agent, 'build');
    const listed = await listOpenCodeSessions({ cwd: dir });
    const ids = listed.sessions.map((s) => s.sessionId);
    assert.ok(ids.includes(ROOT) && ids.includes(RUNNING));
    assert.ok(!ids.includes(CHILD), 'subagents are not listed as sessions of their own');
  });

  await t.test('subagents hang off their caller', () => {
    assert.deepStrictEqual(listChildSessionIds(ROOT), [CHILD]);
    assert.strictEqual(listChildSessions(ROOT)[0]?.agent, 'general');
    assert.strictEqual(findRootSessionId(CHILD), ROOT);
  });

  await t.test('a session with a tool still running is live; a finished one is not', () => {
    const live = activeRootSessionIds([ROOT, RUNNING], V2_NOW, V2_NOW - 1_000_000);
    assert.ok(live.has(RUNNING));
    assert.ok(!live.has(ROOT));
  });

  await t.test('spend counts each answer once, by model and agent', () => {
    const spend = boardSpend([{ id: 'p1', name: 'web-app', path: dir, createdAt: 0 }], V2_NOW + 1_000, 'en-US', 'UTC');
    assert.strictEqual(spend.month.cost, 0.75);
    assert.strictEqual(spend.month.messages, 3);
    assert.deepStrictEqual(spend.byModel.map((b) => b.key), ['stub/m']);
    assert.deepStrictEqual(spend.byAgent.map((b) => [b.key, b.cost]), [['build', 0.5], ['general', 0.25]]);
  });

  await t.test("the model list is the catalog 2.x cached last, when there is no models.json", () => {
    const missing = `${dir}/no-models.json`;
    const catalog = loadModelCatalog(missing, []);
    assert.strictEqual(catalog.get('stub/m')?.contextLimit, 54_321);
    assert.strictEqual(catalog.get('stub/m')?.output, 2);
    assert.ok(catalogFromDb()?.stamp.startsWith('kv:'));
    // Nothing cached and no file: an empty list, not an error.
    assert.strictEqual(loadModelCatalog(missing, [], () => null).size, 0);
  });

  await t.test('a copy keeps every row, its order, and the sequence counter', () => {
    const copy = cloneOpenCodeSession(ROOT, 'Side chat');
    assert.ok(copy);
    assert.strictEqual(copy.costAtFork, 0.5);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const session = db.prepare('SELECT * FROM session_v2 WHERE id = ?').get(copy.sessionId) as any;
      assert.strictEqual(session.title, 'Side chat');
      assert.strictEqual(session.parent_id, null);
      assert.strictEqual(session.fork_session_id, null);
      assert.strictEqual(session.version, '2.0.24');
      const rows = (sessionId: string) =>
        (db.prepare('SELECT id, type, seq, data FROM session_message WHERE session_id = ? ORDER BY seq').all(sessionId) as any[])
          .map((r) => ({ ...r }));
      const original = rows(ROOT);
      const copied = rows(copy.sessionId);
      assert.deepStrictEqual(copied.map(({ type, seq, data }) => ({ type, seq, data })), original.map(({ type, seq, data }) => ({ type, seq, data })));
      const copiedIds = copied.map((r) => r.id);
      assert.deepStrictEqual([...copiedIds].sort(), copiedIds, 'ids ascend with seq');
      assert.ok(copiedIds.every((id) => !original.some((r) => r.id === id)));
      const counter = db.prepare('SELECT seq FROM event_sequence WHERE aggregate_id = ?').get(copy.sessionId) as any;
      assert.strictEqual(counter?.seq, 21);
    } finally {
      db.close();
    }
    closeReadDb();
    assert.deepStrictEqual(
      loadSessionHistory(copy.sessionId).logs.map((l) => l.text),
      loadSessionHistory(ROOT).logs.map((l) => l.text)
    );
  });
});
