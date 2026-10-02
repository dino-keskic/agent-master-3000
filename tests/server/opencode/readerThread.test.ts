import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { isMainThread } from 'node:worker_threads';
import { runRead } from '../../../server/opencode/reads.js';
import { readOffThread } from '../../../server/opencode/readerThread.js';
import { NOW, makeFixture } from '../../fixtures/opencodeDb.js';

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

  fs.rmSync(root, { recursive: true, force: true });
});
