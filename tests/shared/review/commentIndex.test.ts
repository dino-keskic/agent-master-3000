import test from 'node:test';
import assert from 'node:assert';
import { parseUnifiedDiff } from '../../../shared/git/diff.js';
import {
  commentIndex,
  commentPreview,
  plainCommentText,
  workspaceCommentIndex
} from '../../../shared/review/commentIndex.js';
import { comment, twoLineDiff } from '../../fixtures/changelog.js';

test('commentIndex orders open notes before resolved, then by file and line', () => {
  const files = parseUnifiedDiff(
    [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' one',
      '+two',
      '+three'
    ].join('\n')
  );
  const entries = commentIndex(
    [
      comment({ id: 'later', path: 'src/a.ts', newLine: 3, body: 'third line' }),
      comment({ id: 'done', path: 'src/a.ts', newLine: 2, body: 'handled', resolvedAt: 5 }),
      comment({ id: 'earlier', path: 'src/a.ts', newLine: 2, body: 'second line\nmore detail' }),
      comment({ id: 'gone', path: 'src/zz.ts', newLine: 9, body: 'file left the diff' })
    ],
    files
  );

  assert.deepStrictEqual(entries.map((e) => e.id), ['earlier', 'later', 'gone', 'done']);
  // The row is one line, so a multi-line note shows only its first.
  assert.strictEqual(entries[0]!.preview, 'second line');
  assert.strictEqual(entries[0]!.location, 'src/a.ts:2');
  assert.strictEqual(entries[0]!.orphaned, false);
  assert.strictEqual(entries[2]!.orphaned, true);
  assert.strictEqual(entries[3]!.resolved, true);
});

test('commentIndex counts replies and reports a file-level note by path alone', () => {
  const entries = commentIndex(
    [
      comment({
        id: 'f',
        path: 'src/a.ts',
        side: 'file',
        newLine: undefined,
        body: 'whole file',
        replies: [
          { id: 'r1', author: 'agent', body: 'ok', createdAt: 2 },
          { id: 'r2', author: 'user', body: 'thanks', createdAt: 3 }
        ]
      })
    ],
    []
  );
  assert.strictEqual(entries[0]!.location, 'src/a.ts');
  assert.strictEqual(entries[0]!.replyCount, 2);
});

test('plainCommentText takes the markdown off without collapsing the lines', () => {
  const body = [
    '## Heading',
    'Use `parseDiff()` here, see [the note](https://example.com/x).',
    '- **first** item',
    '2) second item',
    '> quoted',
    '```ts',
    'const secret = 1;',
    '```'
  ].join('\n');
  assert.deepStrictEqual(plainCommentText(body).split('\n').filter(Boolean), [
    'Heading',
    'Use parseDiff() here, see the note.',
    'first item',
    'second item',
    'quoted'
  ]);
});

test('a preview is the first real line, not the markup above it', () => {
  assert.strictEqual(commentPreview('## Title\nand the point'), 'Title');
  assert.strictEqual(commentPreview('```\ncode\n```\nthe point'), 'the point');
  assert.strictEqual(commentPreview('*emphasis* and `code`'), 'emphasis and code');
});

test('a preview still stops at one line and one clip', () => {
  assert.strictEqual(commentPreview('first line\nsecond line'), 'first line');
  const long = commentPreview(`- ${'x'.repeat(300)}`);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length <= 141);
});

test('the index says which folder each note is on, once a task has two', () => {
  const workspaces = [
    { cwd: '/code/api', title: 'api', files: twoLineDiff('src/index.ts') },
    { cwd: '/code/app', title: 'app', files: twoLineDiff('src/index.ts') }
  ];
  const entries = workspaceCommentIndex(
    [
      comment({ id: 'api', path: 'src/index.ts', newLine: 2, body: 'in the api', cwd: '/code/api' }),
      comment({ id: 'app', path: 'src/index.ts', newLine: 3, body: 'in the app', cwd: '/code/app' })
    ],
    workspaces
  );
  // Same path in both — without the folder the two rows would read identically.
  assert.deepStrictEqual(entries.map((e) => e.id), ['api', 'app']);
  assert.deepStrictEqual(entries.map((e) => e.workspace), ['api', 'app']);

  // One folder is the ordinary case, and naming it would be noise.
  const alone = workspaceCommentIndex(
    [comment({ id: 'api', path: 'src/index.ts', newLine: 2, body: 'in the api', cwd: '/code/api' })],
    [workspaces[0]!]
  );
  assert.strictEqual(alone[0]!.workspace, undefined);
});

test('a folderless note is listed once, on the folder that still has its line', () => {
  const entries = workspaceCommentIndex(
    [comment({ id: 'old', path: 'src/index.ts', newLine: 3, body: 'written before folders' })],
    [
      { cwd: '/code/api', title: 'api', files: [] },
      { cwd: '/code/app', title: 'app', files: twoLineDiff('src/index.ts') }
    ]
  );
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0]!.workspace, 'app');
  assert.strictEqual(entries[0]!.orphaned, false);
});

test('a note whose folder is no longer on the board is still in the index', () => {
  const entries = workspaceCommentIndex(
    [comment({ id: 'moved', path: 'src/index.ts', newLine: 2, body: 'left behind', cwd: '/code/gone' })],
    [{ cwd: '/code/api', title: 'api', files: twoLineDiff('src/index.ts') }]
  );
  // The session that wrote it has moved on; losing the note with it would mean
  // an unanswered review comment simply disappearing.
  assert.deepStrictEqual(entries.map((e) => e.id), ['moved']);
  assert.strictEqual(entries[0]!.orphaned, true);
});
