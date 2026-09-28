import test from 'node:test';
import assert from 'node:assert';
import { parseUnifiedDiff } from '../../../shared/git/diff.js';
import {
  buildChangelogComment,
  commentLocation,
  commentMatchesLine,
  commentsInWorkspace,
  commentsOnLine,
  countOpenAndResolved,
  openChangelogComments,
  orphanedComments
} from '../../../shared/review/changelogComments.js';
import { comment } from '../../fixtures/changelog.js';

test('openChangelogComments skips resolved threads', () => {
  const comments = [
    comment({ id: 'a', path: 'src/a.ts', body: 'open' }),
    comment({ id: 'b', path: 'src/b.ts', body: 'done', resolvedAt: 2 })
  ];
  assert.deepStrictEqual(openChangelogComments(comments).map((item) => item.id), ['a']);
  assert.deepStrictEqual(openChangelogComments(undefined), []);
});

test('commentLocation prefers the post-image line', () => {
  assert.strictEqual(commentLocation(comment({ id: 'a', path: 'src/a.ts', body: 'n', newLine: 4 })), 'src/a.ts:4');
  assert.strictEqual(
    commentLocation(comment({ id: 'a', path: 'src/a.ts', body: 'n', side: 'del', newLine: undefined, oldLine: 9 })),
    'src/a.ts:9'
  );
  assert.strictEqual(
    commentLocation(comment({ id: 'a', path: 'src/a.ts', body: 'n', side: 'file', newLine: undefined })),
    'src/a.ts'
  );
});

test('commentMatchesLine anchors deletions to the old side', () => {
  const added = comment({ id: 'a', path: 'src/a.ts', body: 'n', side: 'add', newLine: 11 });
  const deleted = comment({
    id: 'b',
    path: 'src/a.ts',
    body: 'n',
    side: 'del',
    newLine: undefined,
    oldLine: 10
  });
  assert.ok(commentMatchesLine(added, { kind: 'add', text: 'x', newLine: 11 }));
  assert.ok(!commentMatchesLine(added, { kind: 'add', text: 'x', newLine: 12 }));
  assert.ok(commentMatchesLine(deleted, { kind: 'del', text: 'x', oldLine: 10 }));
  assert.ok(!commentMatchesLine(deleted, { kind: 'add', text: 'x', newLine: 10 }));
});

test('orphanedComments are notes whose line left the current diff', () => {
  const files = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 context
-old
+new
`);
  const comments = [
    comment({ id: 'live', path: 'src/a.ts', body: 'on add', side: 'add', newLine: 2, snippet: '+new' }),
    comment({ id: 'gone-line', path: 'src/a.ts', body: 'moved', side: 'add', newLine: 99 }),
    comment({ id: 'gone-file', path: 'src/missing.ts', body: 'elsewhere', newLine: 1 })
  ];
  assert.deepStrictEqual(orphanedComments(comments, files).map((item) => item.id), ['gone-line', 'gone-file']);
  assert.strictEqual(commentsOnLine(comments, 'src/a.ts', { kind: 'add', text: 'new', newLine: 2 })[0]?.id, 'live');
});

test('buildChangelogComment rejects a blank body', () => {
  assert.strictEqual(buildChangelogComment({ path: 'a.ts', side: 'add', body: '  ' }, 'id'), null);
  assert.ok(buildChangelogComment({ path: 'a.ts', side: 'add', body: 'note' }, 'id'));
});

test('countOpenAndResolved splits a task’s notes for the index header', () => {
  assert.deepStrictEqual(
    countOpenAndResolved([
      comment({ id: 'a', path: 'x', body: 'open' }),
      comment({ id: 'b', path: 'x', body: 'done', resolvedAt: 1 })
    ]),
    { open: 1, resolved: 1 }
  );
  assert.deepStrictEqual(countOpenAndResolved(undefined), { open: 0, resolved: 0 });
});

test('a note names the folder it was written on, and an old one names none', () => {
  const notes = [
    comment({ id: 'api', path: 'src/index.ts', body: 'here', cwd: '/code/api' }),
    comment({ id: 'app', path: 'src/index.ts', body: 'there', cwd: '/code/app' }),
    comment({ id: 'old', path: 'src/index.ts', body: 'before folders' })
  ];
  // Each folder sees its own notes, and the folderless one everywhere: it was
  // written when a task meant one folder, so it belongs to whichever shows it.
  assert.deepStrictEqual(commentsInWorkspace(notes, '/code/api').map((c) => c.id), ['api', 'old']);
  assert.deepStrictEqual(commentsInWorkspace(notes, '/code/app').map((c) => c.id), ['app', 'old']);
  assert.deepStrictEqual(commentsInWorkspace(undefined, '/code/api'), []);
});
