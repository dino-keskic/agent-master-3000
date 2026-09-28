import test from 'node:test';
import assert from 'node:assert';
import { editDiff } from '../../../shared/agent/editDiff.js';
import { DiffFile, DiffHunk } from '../../../shared/git/diff.js';
import { ToolCallInfo } from '../../../shared/types.js';

/** An edit tool call with the given input, which is all the differ looks at. */
const call = (rawInput: Record<string, unknown>, over: Partial<ToolCallInfo> = {}): ToolCallInfo => ({
  toolCallId: 't1',
  name: 'edit',
  status: 'completed',
  rawInput,
  ...over
});

const alphabet = (letters: string) => letters.split('').join('\n') + '\n';

/** `-3+3 a` style shorthand, so a hunk's shape can be asserted on one line. */
const shape = (hunk: DiffHunk) =>
  hunk.lines
    .map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`)
    .join('|');

const onlyFile = (input: Record<string, unknown>): DiffFile => {
  const diff = editDiff(call(input));
  assert.ok(diff, 'expected a diff');
  assert.equal(diff.files.length, 1);
  return diff.files[0]!;
};

test('a one-line change in the middle becomes one hunk with three lines of context', () => {
  const file = onlyFile({
    filePath: '/repo/src/a.ts',
    oldString: alphabet('abcdefghij'),
    newString: alphabet('abcdEfghij')
  });

  assert.equal(file.path, '/repo/src/a.ts');
  assert.equal(file.status, 'modified');
  assert.deepEqual([file.additions, file.deletions], [1, 1]);
  assert.equal(file.hunks.length, 1);

  const hunk = file.hunks[0]!;
  assert.equal(shape(hunk), ' b| c| d|-e|+E| f| g| h');
  assert.deepEqual([hunk.oldStart, hunk.newStart], [2, 2]);
  // The removal and the addition are the same line on their own side.
  assert.equal(hunk.lines[3]!.oldLine, 5);
  assert.equal(hunk.lines[4]!.newLine, 5);
  // Everything after the change is renumbered on both sides, not just one.
  assert.deepEqual(
    hunk.lines[5],
    { kind: 'ctx', text: 'f', oldLine: 6, newLine: 6 }
  );
});

test('an insertion adds lines and shifts only the new side', () => {
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet('abcdefgh'),
    newString: alphabet('abcdXefgh')
  });

  assert.deepEqual([file.additions, file.deletions], [1, 0]);
  assert.equal(shape(file.hunks[0]!), ' b| c| d|+X| e| f| g');
  const inserted = file.hunks[0]!.lines[3]!;
  assert.equal(inserted.newLine, 5);
  assert.equal(inserted.oldLine, undefined);
  // 'e' was line 5 before and is line 6 after.
  assert.deepEqual(file.hunks[0]!.lines[4], { kind: 'ctx', text: 'e', oldLine: 5, newLine: 6 });
});

test('a deletion removes lines and shifts only the old side', () => {
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet('abcdefgh'),
    newString: alphabet('abcdfgh')
  });

  assert.deepEqual([file.additions, file.deletions], [0, 1]);
  assert.equal(shape(file.hunks[0]!), ' b| c| d|-e| f| g| h');
  assert.deepEqual(file.hunks[0]!.lines[4], { kind: 'ctx', text: 'f', oldLine: 6, newLine: 5 });
});

test('a change on the first line clamps the leading context', () => {
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet('abcdefgh'),
    newString: alphabet('Abcdefgh')
  });

  const hunk = file.hunks[0]!;
  assert.equal(shape(hunk), '-a|+A| b| c| d');
  assert.deepEqual([hunk.oldStart, hunk.newStart], [1, 1]);
});

test('a change on the last line clamps the trailing context', () => {
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet('abcdefgh'),
    newString: alphabet('abcdefgH')
  });

  const hunk = file.hunks[0]!;
  assert.equal(shape(hunk), ' e| f| g|-h|+H');
  assert.deepEqual([hunk.oldStart, hunk.newStart], [5, 5]);
});

test('two changes far apart make two hunks, and near ones share one', () => {
  const twenty = 'abcdefghijklmnopqrst';
  const far = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet(twenty),
    newString: alphabet('AbcdefghijklmnopqrsT')
  });
  assert.equal(far.hunks.length, 2, 'nineteen lines apart is two hunks');
  assert.deepEqual([far.hunks[0]!.oldStart, far.hunks[1]!.oldStart], [1, 17]);
  assert.deepEqual([far.additions, far.deletions], [2, 2]);

  // Six unchanged lines between two changes is exactly 2 * CONTEXT, so the
  // context would overlap and the two changes belong to one hunk.
  const near = onlyFile({
    filePath: 'a.ts',
    oldString: alphabet(twenty),
    newString: alphabet('abcDefghijKlmnopqrst')
  });
  assert.equal(near.hunks.length, 1);
  assert.equal(shape(near.hunks[0]!), ' a| b| c|-d|+D| e| f| g| h| i| j|-k|+K| l| m| n');
});

test('a repeated line is diffed where it moved, not where it first matches', () => {
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: 'x\nsame\ny\nsame\nz\n',
    newString: 'x\nsame\nY\nsame\nz\n'
  });

  assert.deepEqual([file.additions, file.deletions], [1, 1]);
  assert.equal(shape(file.hunks[0]!), ' x| same|-y|+Y| same| z');
});

test('an oldString that is only part of a line still diffs, numbered from the snippet', () => {
  // The call carries the two snippets, never the file, so there is nothing to
  // anchor them to: line 1 of the diff is line 1 of oldString.
  const file = onlyFile({
    filePath: 'a.ts',
    oldString: 'const a = 1;',
    newString: 'const a = 2;'
  });

  assert.equal(shape(file.hunks[0]!), '-const a = 1;|+const a = 2;');
  assert.deepEqual([file.hunks[0]!.oldStart, file.hunks[0]!.newStart], [1, 1]);
});

test('an empty oldString reads as a new file', () => {
  const file = onlyFile({ filePath: 'new.ts', oldString: '', newString: 'a\nb\n' });
  assert.equal(file.status, 'added');
  assert.deepEqual([file.additions, file.deletions], [2, 0]);
  assert.equal(shape(file.hunks[0]!), '+a|+b');
});

test('write turns its content into an all-additions diff', () => {
  const diff = editDiff(call({ filePath: 'w.ts', content: 'a\nb\nc\n' }, { name: 'write' }));
  assert.ok(diff);
  const file = diff.files[0]!;
  assert.equal(file.status, 'added');
  assert.deepEqual([file.additions, file.deletions], [3, 0]);
  assert.equal(file.hunks[0]!.newStart, 1);
  assert.equal(diff.truncated, false);
});

test('apply_patch is parsed as the unified diff it already is', () => {
  const patchText = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,3 +3,3 @@',
    ' keep',
    '-old',
    '+new',
    ' tail',
    ''
  ].join('\n');

  const diff = editDiff(call({ patchText }, { name: 'apply_patch' }));
  assert.ok(diff);
  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0]!.path, 'src/a.ts');
  assert.deepEqual([diff.files[0]!.additions, diff.files[0]!.deletions], [1, 1]);
  assert.equal(diff.files[0]!.hunks[0]!.oldStart, 3);
});

test('nothing to show returns null so the JSON body stays', () => {
  assert.equal(editDiff(call({ pattern: 'foo', path: '/repo' }, { name: 'grep' })), null, 'not an edit');
  assert.equal(
    editDiff(call({ filePath: 'a.ts', oldString: 'a\n', newString: 'a\n' })),
    null,
    'an edit that changed nothing'
  );
  assert.equal(editDiff(call({ filePath: 'a.ts' })), null, 'no strings and no content');
  assert.equal(editDiff(call({ patchText: 'not a patch at all' }, { name: 'apply_patch' })), null);
  assert.equal(editDiff(call({ patchText: '   ' }, { name: 'apply_patch' })), null);
  assert.equal(editDiff({ toolCallId: 't', name: 'edit', status: 'completed' }), null, 'no input');
  assert.equal(
    editDiff(call({ filePath: 'a.ts', oldString: 'a', newString: 42 })),
    null,
    'newString is not a string'
  );
});

test('a huge replacement is capped in both input and rendered rows', () => {
  const big = (mark: string) =>
    Array.from({ length: 10_000 }, (_, i) => `${mark} line ${i}`).join('\n') + '\n';

  const diff = editDiff(call({ filePath: 'big.ts', oldString: big('a'), newString: big('b') }));
  assert.ok(diff);
  assert.equal(diff.truncated, true);
  assert.equal(diff.files[0]!.truncated, true);

  const rows = diff.files[0]!.hunks.reduce((sum, hunk) => sum + hunk.lines.length, 0);
  assert.ok(rows <= 800, `expected at most 800 rows, got ${rows}`);
  assert.ok(rows > 0, 'a capped diff still shows the start of the change');
});

test('a few very long lines are capped by bytes, not by line count', () => {
  const line = (mark: string, i: number) => `${mark}${i}${'x'.repeat(30_000)}`;
  const wide = (mark: string) => Array.from({ length: 6 }, (_, i) => line(mark, i)).join('\n');

  const diff = editDiff(call({ filePath: 'min.js', oldString: wide('a'), newString: wide('b') }));
  assert.ok(diff);
  assert.equal(diff.truncated, true);
  // Six lines is well under MAX_SIDE_LINES; only the byte budget can cut this.
  assert.ok(diff.files[0]!.additions < 6, 'the tail of a very wide file is dropped');
});
