import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { TaskStore } from '../../../server/board/taskStore.js';
import { TEST_DATA_DIR } from '../../fixtures/taskStore.js';

test('TaskStore persists changelog comments locally', () => {
  const file = path.join(TEST_DATA_DIR, 'test_changelog_comments.json');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  const store = new TaskStore(file);
  const task = store.createTask({ title: 'Notes', prompt: 'review the diff' });

  const withComment = store.addChangelogComment(task.id, {
    path: 'src/a.ts',
    side: 'add',
    newLine: 4,
    snippet: '+ hi',
    body: 'say hello instead'
  });
  assert.ok(withComment);
  assert.strictEqual(withComment.changelogComments?.length, 1);
  const id = withComment.changelogComments[0]!.id;

  const replied = store.replyToChangelogComment(task.id, id, 'done in the next hunk', 'agent');
  assert.strictEqual(replied!.changelogComments![0]!.replies[0]!.author, 'agent');

  const resolved = store.resolveChangelogComment(task.id, id, true);
  assert.ok(resolved!.changelogComments![0]!.resolvedAt);

  const reopened = store.resolveChangelogComment(task.id, id, false);
  assert.strictEqual(reopened!.changelogComments![0]!.resolvedAt, undefined);

  const deleted = store.deleteChangelogComment(task.id, id);
  assert.strictEqual(deleted!.changelogComments!.length, 0);

  store.flush();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
});

test('applyChangelogResponses writes a whole turn of replies and resolutions at once', () => {
  const file = path.join(TEST_DATA_DIR, 'test_changelog_batch.json');
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
  const store = new TaskStore(file);
  const task = store.createTask({ title: 'Notes', prompt: 'review the diff' });
  const ids = ['first', 'second', 'third'].map((body) => {
    const updated = store.addChangelogComment(task.id, { path: 'src/a.ts', side: 'add', newLine: 1, body });
    return updated!.changelogComments!.at(-1)!.id;
  });

  const outcome = store.applyChangelogResponses(
    task.id,
    [
      { commentId: ids[0]!, reply: 'renamed', status: 'resolved' },
      { commentId: ids[1]!, status: 'resolved' },
      { commentId: ids[2]!, reply: 'still looking' },
      { commentId: 'missing', reply: 'who?' }
    ],
    'agent'
  );

  assert.ok(outcome);
  assert.deepStrictEqual(outcome.result.missing, ['missing']);
  assert.deepStrictEqual(
    outcome.result.applied.map((item) => `${item.replied}:${item.status ?? '-'}`),
    ['true:resolved', 'false:resolved', 'true:-']
  );
  const comments = outcome.task.changelogComments!;
  assert.strictEqual(comments[0]!.replies[0]!.author, 'agent');
  assert.ok(comments[0]!.resolvedAt && comments[1]!.resolvedAt);
  assert.strictEqual(comments[2]!.resolvedAt, undefined);

  const reopened = store.applyChangelogResponses(task.id, [{ commentId: ids[0]!, status: 'open' }]);
  assert.strictEqual(reopened!.task.changelogComments![0]!.resolvedAt, undefined);

  assert.strictEqual(store.applyChangelogResponses('TASK-nope', [{ commentId: ids[0]! }]), null);

  store.flush();
  fs.rmSync(file, { force: true });
  fs.rmSync(`${file}.logs`, { recursive: true, force: true });
});
