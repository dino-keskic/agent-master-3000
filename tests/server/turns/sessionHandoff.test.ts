import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { NOW, makeFixture, openCodeId } from '../../fixtures/opencodeDb.js';

/**
 * A session moved to another folder on the board continues in a copy OpenCode
 * files there. These run the real handoff against a throwaway OpenCode database
 * and board file: the copy has to be filed right, read back as the same
 * conversation, and take over from the original on the task.
 */

const fixture = makeFixture();
const board = path.join(fixture.root, 'board_state.json');
// Both are read when the modules load, so they are set before importing them —
// and nothing above may import the store, or it loads with the defaults.
process.env.OPENCODE_DB = fixture.file;
process.env.BOARD_STATE_FILE = board;
const { handOffMovedSession } = await import('../../../server/turns/sessionHandoff.js');
const { taskStore } = await import('../../../server/board/taskStore.js');
const { DEFAULT_FILE_PATH } = await import('../../../server/board/stateFile.js');
assert.strictEqual(DEFAULT_FILE_PATH, board, 'the shared store must use the throwaway board file');

// The store writes itself out on exit, so its folder goes after that — this
// handler is registered after the store's, so it runs after it.
process.on('exit', () => {
  fs.rmSync(fixture.root, { recursive: true, force: true });
});

const T = NOW + 5_000_000;
const elsewhere = path.join(fixture.root, 'api-service');
fs.mkdirSync(elsewhere, { recursive: true });

{
  const db = new DatabaseSync(fixture.file);
  db.prepare(`INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES (?, ?, 1, 1, '[]')`)
    .run('proj-api', elsewhere);
  db.close();
}

let counter = 0;
/** An OpenCode session in `folder` holding one thinking turn. */
function seedSession(id: string, folder: string): void {
  const base = T + 100_000 * ++counter;
  const db = new DatabaseSync(fixture.file);
  db.prepare(`
    INSERT INTO session (id, project_id, parent_id, directory, title, time_created, time_updated, summary_files, summary_additions, summary_deletions, agent, tokens_input, cost)
    VALUES (?, 'proj-spa', NULL, ?, ?, ?, ?, 0, 0, 0, 'build', 1, 7.5)
  `).run(id, folder, id, base, base);
  const user = openCodeId('msg', base, 1);
  const reply = openCodeId('msg', base + 1, 1);
  const message = db.prepare('INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)');
  const part = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)');
  message.run(user, id, base, base, JSON.stringify({ role: 'user' }));
  message.run(reply, id, base + 1, base + 1, JSON.stringify({ role: 'assistant', providerID: 'anthropic' }));
  part.run(openCodeId('prt', base, 1), user, id, base, base, JSON.stringify({ type: 'text', text: 'Give me a ticket.' }));
  const kinds = ['step-start', 'reasoning', 'tool', 'reasoning', 'text', 'step-finish'];
  kinds.forEach((type, i) =>
    part.run(
      openCodeId('prt', base + 1, i + 1, i % 2 ? 'zzzzzzzzzzzzzz' : '00000000000000'),
      reply,
      id,
      base + 1,
      base + 1,
      JSON.stringify({ type, text: `${type} ${i}`, metadata: { anthropic: { signature: `sig-${i}` } } })
    ));
  db.close();
}

/** The conversation as OpenCode sends it, ids left out. */
function conversation(sessionId: string) {
  const db = new DatabaseSync(fixture.file, { readOnly: true });
  try {
    const messages = db.prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id')
      .all(sessionId) as { id: string; data: string }[];
    return messages.map((message) => ({
      data: message.data,
      parts: (db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id').all(message.id) as { data: string }[])
        .map((row) => row.data)
    }));
  } finally {
    db.close();
  }
}

function sessionRow(sessionId: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(fixture.file, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM session WHERE id = ?').get(sessionId);
  } finally {
    db.close();
  }
}

function taskIn(folder: string, sessionId: string, linkCwd: string) {
  const task = taskStore.createTask({ title: `Task for ${sessionId}`, prompt: 'go', cwd: folder });
  taskStore.linkSession(task.id, {
    sessionId,
    title: 'Main',
    kind: 'main',
    origin: 'initial',
    primary: true,
    cwd: linkCwd
  });
  return taskStore.getTask(task.id)!;
}

test('a session moved to another folder continues in a copy filed there', () => {
  seedSession('ses-moved', fixture.live);
  const task = taskIn(fixture.live, 'ses-moved', elsewhere);

  const copy = handOffMovedSession(task, 'ses-moved');
  assert.ok(copy, 'a handoff happened');
  assert.notStrictEqual(copy, 'ses-moved');

  const row = sessionRow(copy)!;
  assert.strictEqual(row.directory, elsewhere, 'OpenCode files the copy under the new folder');
  assert.strictEqual(row.project_id, 'proj-api', 'and under that folder\'s project');
  assert.strictEqual(row.parent_id, null);
  assert.deepStrictEqual(conversation(copy), conversation('ses-moved'), 'the model is sent the same conversation');
  assert.strictEqual(sessionRow('ses-moved')!.directory, fixture.live, 'the original stays where it was');
});

test('the copy takes over the task and the original is retired', () => {
  seedSession('ses-takeover', fixture.live);
  const task = taskIn(fixture.live, 'ses-takeover', elsewhere);

  const copy = handOffMovedSession(task, 'ses-takeover')!;
  const updated = taskStore.getTask(task.id)!;
  assert.strictEqual(updated.sessionId, copy, 'follow-ups go to the copy');
  const link = updated.sessions?.find((entry) => entry.sessionId === copy);
  assert.ok(link);
  assert.strictEqual(link.forkedFrom, 'ses-takeover');
  assert.strictEqual(link.cwd, elsewhere);
  assert.strictEqual(link.costAtFork, 7.5, 'spend already on the original is not billed again');
  assert.ok(updated.sessions?.find((entry) => entry.sessionId === 'ses-takeover')?.archivedAt, 'the original is archived');
  assert.ok(
    updated.logs?.some((log) => log.sessionId === copy && log.text.includes(elsewhere)),
    'the task log says where the session went'
  );
});

test('a session still in its folder is left alone', () => {
  seedSession('ses-home', fixture.live);
  const task = taskIn(fixture.live, 'ses-home', fixture.live);
  const sessions = (() => {
    const db = new DatabaseSync(fixture.file, { readOnly: true });
    const n = (db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n;
    db.close();
    return n;
  })();

  assert.strictEqual(handOffMovedSession(task, 'ses-home'), undefined);
  assert.strictEqual(taskStore.getTask(task.id)!.sessionId, 'ses-home');
  const db = new DatabaseSync(fixture.file, { readOnly: true });
  assert.strictEqual((db.prepare('SELECT COUNT(*) AS n FROM session').get() as { n: number }).n, sessions, 'no copy was made');
  db.close();
});

test('a trailing slash is not a move', () => {
  seedSession('ses-slash', fixture.live);
  const task = taskIn(fixture.live, 'ses-slash', `${fixture.live}/`);
  assert.strictEqual(handOffMovedSession(task, 'ses-slash'), undefined);
});

test('a session the board has no link for is not handed off', () => {
  seedSession('ses-unlinked', fixture.live);
  const task = taskStore.createTask({ title: 'No link', prompt: 'go', cwd: elsewhere });
  assert.strictEqual(handOffMovedSession(task, 'ses-unlinked'), undefined);
  assert.strictEqual(handOffMovedSession(task, undefined), undefined);
});

test('a session OpenCode does not know is not handed off', () => {
  const task = taskIn(fixture.live, 'ses-nowhere', elsewhere);
  assert.strictEqual(handOffMovedSession(task, 'ses-nowhere'), undefined);
});

test('a copy of a moved copy still reads back as the original', () => {
  seedSession('ses-twice', fixture.live);
  const task = taskIn(fixture.live, 'ses-twice', elsewhere);
  const first = handOffMovedSession(task, 'ses-twice')!;

  // Moved back again: the copy is now the one out of place.
  const moved = taskStore.getTask(task.id)!;
  const link = moved.sessions!.find((entry) => entry.sessionId === first)!;
  link.cwd = fixture.live;
  const second = handOffMovedSession(moved, first);
  assert.ok(second);
  assert.strictEqual(sessionRow(second)!.directory, fixture.live);
  assert.deepStrictEqual(conversation(second), conversation('ses-twice'));
});

test('the copy runs as whatever the original was told to run as', () => {
  seedSession('ses-picked', fixture.live);
  const task = taskIn(fixture.live, 'ses-picked', elsewhere);
  const link = task.sessions!.find((entry) => entry.sessionId === 'ses-picked')!;
  link.chosen = { model: 'opencode/gpt-6-astra' };

  const copy = handOffMovedSession(task, 'ses-picked')!;
  const moved = taskStore.getTask(task.id)!.sessions!.find((entry) => entry.sessionId === copy);
  assert.strictEqual(moved?.chosen?.model, 'opencode/gpt-6-astra', 'moving folders is not a model change');
});
