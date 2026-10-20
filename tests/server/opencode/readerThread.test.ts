import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { isMainThread } from 'node:worker_threads';
import { runRead } from '../../../server/opencode/reads.js';
import { interactively, readOffThread } from '../../../server/opencode/readerThread.js';
import { NOW, makeFixture } from '../../fixtures/opencodeDb.js';
import { task } from '../../fixtures/boardTasks.js';

test('OpenCode reads on the reader thread', async (t) => {
  const { file, root } = makeFixture();
  process.env.OPENCODE_DB = file;
  assert.ok(isMainThread);

  await t.test('a transcript read off the thread is the one read inline', async () => {
    const offThread = await readOffThread('sessionHistory', 'ses-diff-yesterday', 0);
    assert.deepStrictEqual(offThread, runRead('sessionHistory', ['ses-diff-yesterday', 0]));
    assert.ok(offThread.logs.length > 0, 'the fixture session has a transcript');
  });

  await t.test('Maps and Sets come back as Maps and Sets', async () => {
    const sessions = await readOffThread('sessionsById', ['ses-diff-yesterday']);
    assert.ok(sessions instanceof Map);
    assert.deepStrictEqual(sessions, runRead('sessionsById', [['ses-diff-yesterday']]));

    const active = await readOffThread('activeRootSessionIds', ['ses-diff-yesterday'], NOW, NOW - 60_000);
    assert.ok(active instanceof Set);
    assert.deepStrictEqual(active, runRead('activeRootSessionIds', [['ses-diff-yesterday'], NOW, NOW - 60_000]));
  });

  await t.test('the thread reads the database the main thread resolves now', async () => {
    const elsewhere = makeFixture();
    try {
      process.env.OPENCODE_DB = elsewhere.file + '.missing';
      const none = await readOffThread('sessionsById', ['ses-diff-yesterday']);
      assert.strictEqual(none.size, 0, 'no database there, so no sessions');
      process.env.OPENCODE_DB = file;
      const back = await readOffThread('sessionsById', ['ses-diff-yesterday']);
      assert.strictEqual(back.size, 1);
    } finally {
      process.env.OPENCODE_DB = file;
      fs.rmSync(elsewhere.root, { recursive: true, force: true });
    }
  });

  await t.test('an interactive read answers the same as a background one', async () => {
    const inBackground = await readOffThread('sessionHistory', 'ses-diff-yesterday', 0);
    const interactive = await interactively(() => readOffThread('sessionHistory', 'ses-diff-yesterday', 0));
    assert.deepStrictEqual(interactive, inBackground);
  });

  await t.test('a board spend read already out is joined, not queued again', async () => {
    const first = readOffThread('boardSpend', [], NOW, 'en-US', 'UTC');
    const second = readOffThread('boardSpend', [], NOW + 5, 'en-US', 'UTC');
    const other = readOffThread('boardSpend', [], NOW, 'en-US', 'UTC', { history: true });
    assert.strictEqual(second, first, 'the clock alone does not make a new read');
    assert.notStrictEqual(other, first, 'different options are a different read');
    await Promise.all([first, other]);
    assert.notStrictEqual(readOffThread('boardSpend', [], NOW, 'en-US', 'UTC'), first, 'a finished read is not reused');
  });

  await t.test("a task's spend read already out is joined by the task's id, not its every field", async () => {
    const first = readOffThread('taskSpend', task(), [], NOW, { fresh: true });
    const ticked = readOffThread('taskSpend', task({ runState: 'running', updatedAt: 9_000 }), [], NOW + 10_000, { fresh: true });
    const cached = readOffThread('taskSpend', task(), [], NOW, { fresh: false });
    const other = readOffThread('taskSpend', task({ id: 'TASK-2' }), [], NOW, { fresh: true });
    assert.strictEqual(ticked, first, 'a status tick and the clock do not make a new read');
    assert.notStrictEqual(cached, first, 'skipping the cache is a different read');
    assert.notStrictEqual(other, first, 'another task is another read');
    await Promise.all([first, cached, other]);
  });

  fs.rmSync(root, { recursive: true, force: true });
});
