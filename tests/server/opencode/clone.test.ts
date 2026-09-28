import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import { cloneOpenCodeSession } from '../../../server/opencode/clone.js';
import { NOW, makeFixture, openCodeId } from '../../fixtures/opencodeDb.js';

/**
 * A copied session is sent to the model as its whole history, so it has to read
 * back exactly as the original does. Anthropic rejects a request whose last
 * assistant message has its `thinking` blocks moved or changed — a copy that
 * reorders parts breaks every turn after it.
 */

/** Well clear of the shared fixture's rows, so no id here collides with one there. */
const T = NOW + 1_000_000;
const OPENCODE_ID = /^(msg|prt)_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

interface Row {
  id: string;
  session_id: string;
  message_id?: string;
  time_created: number;
  time_updated: number;
  data: string;
}

/** A session as OpenCode hydrates it: messages by (time_created, id), parts by (message_id, id). */
function readLikeOpenCode(file: string, sessionId: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const messages = db
      .prepare('SELECT * FROM message WHERE session_id = ? ORDER BY time_created, id')
      .all(sessionId) as unknown as Row[];
    const ids = messages.map((message) => message.id);
    const parts = ids.length
      ? (db
          .prepare(`SELECT * FROM part WHERE message_id IN (${ids.map(() => '?').join(', ')}) ORDER BY message_id, id`)
          .all(...ids) as unknown as Row[])
      : [];
    return messages.map((message) => ({
      message,
      parts: parts.filter((part) => part.message_id === message.id)
    }));
  } finally {
    db.close();
  }
}

/** What the model is sent, with the ids that only name the rows left out. */
function conversation(file: string, sessionId: string) {
  return readLikeOpenCode(file, sessionId).map(({ message, parts }) => ({
    data: message.data,
    time_created: message.time_created,
    parts: parts.map((part) => ({ data: part.data, time_created: part.time_created, time_updated: part.time_updated }))
  }));
}

function count(file: string, table: 'message' | 'part', sessionId: string): number {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = ?`).get(sessionId) as { n: number }).n;
  } finally {
    db.close();
  }
}

test('copying an OpenCode session', async (t) => {
  const { file, live, root } = makeFixture();
  process.env.OPENCODE_DB = file;

  const addSession = (id: string) => {
    const db = new DatabaseSync(file);
    db.prepare(`
      INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input)
      VALUES (?, 'proj-spa', NULL, ?, ?, ?, ?, 0, 0, 0, 'build', 1)
    `).run(id, live, id, T, T);
    db.close();
  };
  const addMessage = (sessionId: string, id: string, at: number, data: object) => {
    const db = new DatabaseSync(file);
    db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)')
      .run(id, sessionId, at, at, JSON.stringify(data));
    db.close();
  };
  const addParts = (sessionId: string, messageId: string, parts: { id: string; at: number; data: object }[]) => {
    const db = new DatabaseSync(file);
    const insert = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
    try {
      db.exec('BEGIN');
      for (const part of parts) insert.run(part.id, messageId, sessionId, part.at, part.at + 5, JSON.stringify(part.data));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.close();
    }
  };

  // A real extended-thinking turn: several steps, each with signed reasoning,
  // tool calls and text, all streamed within the same few milliseconds.
  const signed = (n: number) => ({
    type: 'reasoning',
    text: `thinking ${n}`,
    metadata: { anthropic: { signature: `sig-${n}-${'x'.repeat(40)}` } },
    time: { start: T, end: T + 1 }
  });
  addSession('ses-think');
  addMessage('ses-think', openCodeId('msg', T, 1), T, { role: 'user' });
  addParts('ses-think', openCodeId('msg', T, 1), [{ id: openCodeId('prt', T, 1), at: T, data: { type: 'text', text: 'Read and give me a ticket.' } }]);
  addMessage('ses-think', openCodeId('msg', T + 1, 1), T + 1, { role: 'assistant', modelID: 'claude-opus-5', providerID: 'anthropic' });
  const steps = Array.from({ length: 8 }, (_, step) => [
    { type: 'step-start' },
    signed(step),
    { type: 'redacted-reasoning', data: `opaque-${step}` },
    { type: 'tool', tool: 'read', callID: `call-${step}`, state: { status: 'completed', input: { filePath: `/f${step}` }, output: 'ok' } },
    { type: 'text', text: `step ${step} done` },
    { type: 'step-finish', reason: 'tool-calls' }
  ]).flat();
  // Same millisecond, rising counter, and random tails that do not sort in
  // creation order — only the time-and-counter prefix does.
  const tails = ['zzzzzzzzzzzzzz', '00000000000000', 'MMMMMMMMMMMMMM'];
  addParts('ses-think', openCodeId('msg', T + 1, 1), steps.map((data, i) => ({
    id: openCodeId('prt', T + 1, i + 1, tails[i % tails.length]),
    at: T + 1,
    data
  })));

  await t.test('the copy reads back to OpenCode exactly as the original does', () => {
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    assert.deepStrictEqual(conversation(file, cloned.sessionId), conversation(file, 'ses-think'));
  });

  await t.test('signed reasoning keeps its place and its signature, byte for byte', () => {
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    const [, reply] = readLikeOpenCode(file, cloned.sessionId);
    const types = reply!.parts.map((part) => JSON.parse(part.data).type);
    assert.deepStrictEqual(types, steps.map((part) => part.type));
    const reasoning = reply!.parts.filter((part) => JSON.parse(part.data).type === 'reasoning');
    assert.deepStrictEqual(reasoning.map((part) => part.data), steps.filter((p) => p.type === 'reasoning').map((p) => JSON.stringify(p)));
  });

  await t.test('parts follow OpenCode\'s id order, not their timestamps', () => {
    // A part written later can carry an earlier time_created (it is set when
    // the part starts, not when it lands). OpenCode goes by id; so must the copy.
    addSession('ses-skew');
    const message = openCodeId('msg', T + 10_000, 1);
    addMessage('ses-skew', message, T, { role: 'assistant' });
    addParts('ses-skew', message, [
      { id: openCodeId('prt', T + 10_000, 1), at: T + 50, data: { type: 'reasoning', text: 'first' } },
      { id: openCodeId('prt', T + 10_000, 2), at: T + 10, data: { type: 'text', text: 'second' } },
      { id: openCodeId('prt', T + 10_000, 3), at: T, data: { type: 'text', text: 'third' } }
    ]);
    const cloned = cloneOpenCodeSession('ses-skew', 'Copy');
    assert.ok(cloned);
    const [only] = readLikeOpenCode(file, cloned.sessionId);
    assert.deepStrictEqual(only!.parts.map((part) => JSON.parse(part.data).text), ['first', 'second', 'third']);
  });

  await t.test('messages sharing a timestamp keep their order', () => {
    addSession('ses-tied');
    for (let i = 1; i <= 20; i++) {
      const id = openCodeId('msg', T + 20_000, i, i % 2 ? 'zzzzzzzzzzzzzz' : '00000000000000');
      addMessage('ses-tied', id, T, { role: i % 2 ? 'user' : 'assistant', n: i });
      addParts('ses-tied', id, [{ id: openCodeId('prt', T + 20_000, i), at: T, data: { type: 'text', text: `m${i}` } }]);
    }
    const cloned = cloneOpenCodeSession('ses-tied', 'Copy');
    assert.ok(cloned);
    assert.deepStrictEqual(
      readLikeOpenCode(file, cloned.sessionId).map(({ message }) => JSON.parse(message.data).n),
      Array.from({ length: 20 }, (_, i) => i + 1)
    );
    assert.deepStrictEqual(conversation(file, cloned.sessionId), conversation(file, 'ses-tied'));
  });

  await t.test('a message with more parts than one millisecond of ids holds keeps its order', () => {
    // 0x1000 ids fit in a millisecond; past that the counter carries into the time.
    addSession('ses-long');
    const message = openCodeId('msg', T + 30_000, 1);
    addMessage('ses-long', message, T, { role: 'assistant' });
    addParts('ses-long', message, Array.from({ length: 5000 }, (_, i) => ({
      id: openCodeId('prt', T + 30_000 + Math.floor(i / 4000), (i % 4000) + 1),
      at: T,
      data: { type: 'text', text: `p${i}` }
    })));
    const cloned = cloneOpenCodeSession('ses-long', 'Copy');
    assert.ok(cloned);
    const [only] = readLikeOpenCode(file, cloned.sessionId);
    assert.strictEqual(only!.parts.length, 5000);
    assert.ok(only!.parts.every((part, i) => JSON.parse(part.data).text === `p${i}`));
  });

  await t.test('copied ids are well-formed OpenCode ids, unique, and ascending', () => {
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    const read = readLikeOpenCode(file, cloned.sessionId);
    const messageIds = read.map(({ message }) => message.id);
    const partIds = read.flatMap(({ parts }) => parts.map((part) => part.id));
    const all = [...messageIds, ...partIds];
    for (const id of all) assert.match(id, OPENCODE_ID);
    assert.strictEqual(new Set(all).size, all.length);
    assert.deepStrictEqual(messageIds, [...messageIds].sort());
    for (const { parts } of read) {
      const ids = parts.map((part) => part.id);
      assert.deepStrictEqual(ids, [...ids].sort());
    }
  });

  await t.test('every copied row belongs to the copy, and nothing points back at the source', () => {
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    const source = readLikeOpenCode(file, 'ses-think');
    const sourceIds = new Set(source.flatMap(({ message, parts }) => [message.id, ...parts.map((part) => part.id)]));
    for (const { message, parts } of readLikeOpenCode(file, cloned.sessionId)) {
      assert.strictEqual(message.session_id, cloned.sessionId);
      assert.ok(!sourceIds.has(message.id));
      for (const part of parts) {
        assert.strictEqual(part.session_id, cloned.sessionId);
        assert.strictEqual(part.message_id, message.id);
        assert.ok(!sourceIds.has(part.id));
      }
    }
    assert.strictEqual(count(file, 'message', cloned.sessionId), count(file, 'message', 'ses-think'));
    assert.strictEqual(count(file, 'part', cloned.sessionId), count(file, 'part', 'ses-think'));
  });

  await t.test('copying leaves the source untouched', () => {
    const before = readLikeOpenCode(file, 'ses-think');
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    assert.deepStrictEqual(readLikeOpenCode(file, 'ses-think'), before);
  });

  await t.test('copying the same session twice makes two independent copies', () => {
    const first = cloneOpenCodeSession('ses-think', 'One');
    const second = cloneOpenCodeSession('ses-think', 'Two');
    assert.ok(first && second);
    assert.notStrictEqual(first.sessionId, second.sessionId);
    assert.deepStrictEqual(conversation(file, first.sessionId), conversation(file, 'ses-think'));
    assert.deepStrictEqual(conversation(file, second.sessionId), conversation(file, 'ses-think'));
  });

  await t.test('a copy of a copy still reads back as the original', () => {
    const first = cloneOpenCodeSession('ses-think', 'One');
    assert.ok(first);
    const second = cloneOpenCodeSession(first.sessionId, 'Two');
    assert.ok(second);
    assert.deepStrictEqual(conversation(file, second.sessionId), conversation(file, 'ses-think'));
  });

  await t.test('an empty session copies to an empty session', () => {
    addSession('ses-empty');
    const cloned = cloneOpenCodeSession('ses-empty', 'Copy');
    assert.ok(cloned);
    assert.deepStrictEqual(readLikeOpenCode(file, cloned.sessionId), []);
  });

  await t.test('a session that does not exist copies to nothing and writes nothing', () => {
    const db = new DatabaseSync(file, { readOnly: true });
    const sessions = (db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    db.close();
    assert.strictEqual(cloneOpenCodeSession('ses-missing', 'Copy'), null);
    const after = new DatabaseSync(file, { readOnly: true });
    assert.strictEqual((after.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, sessions);
    after.close();
  });

  await t.test('a copy that fails partway leaves no trace behind', () => {
    const db = new DatabaseSync(file);
    const before = {
      sessions: (db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n,
      messages: (db.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number }).n,
      parts: (db.prepare('SELECT COUNT(*) AS n FROM part').get() as { n: number }).n
    };
    // Fail on the last part of the reply, after everything before it went in.
    db.exec(`
      CREATE TRIGGER fail_copy BEFORE INSERT ON part
      WHEN NEW.session_id != 'ses-think' AND NEW.data LIKE '%step 7 done%'
      BEGIN SELECT RAISE(ABORT, 'disk full'); END;
    `);
    db.close();
    try {
      assert.strictEqual(cloneOpenCodeSession('ses-think', 'Doomed'), null);
    } finally {
      const cleanup = new DatabaseSync(file);
      cleanup.exec('DROP TRIGGER fail_copy');
      cleanup.close();
    }
    const after = new DatabaseSync(file, { readOnly: true });
    assert.deepStrictEqual({
      sessions: (after.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n,
      messages: (after.prepare('SELECT COUNT(*) AS n FROM message').get() as { n: number }).n,
      parts: (after.prepare('SELECT COUNT(*) AS n FROM part').get() as { n: number }).n
    }, before);
    assert.strictEqual(after.prepare("SELECT id FROM session WHERE title = 'Doomed'").get(), undefined);
    after.close();
    // And the database is left usable.
    assert.ok(cloneOpenCodeSession('ses-think', 'After'));
  });

  await t.test('the copy is a sibling, never a subagent of the source', () => {
    const cloned = cloneOpenCodeSession('ses-think', 'Copy');
    assert.ok(cloned);
    const db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('SELECT parent_id, title, time_archived FROM session WHERE id = ?').get(cloned.sessionId) as
      Record<string, unknown>;
    db.close();
    assert.strictEqual(row.parent_id, null);
    assert.strictEqual(row.title, 'Copy');
    assert.strictEqual(row.time_archived, null);
  });

  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.OPENCODE_DB;
});
