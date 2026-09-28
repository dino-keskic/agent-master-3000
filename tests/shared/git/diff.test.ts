import test, { describe } from 'node:test';
import assert from 'node:assert';
import { diffStat, fileStatLabel, parseUnifiedDiff, sumDiffStats } from '../../../shared/git/diff.js';

const MODIFIED = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,7 +10,8 @@ export function boot() {
   const a = 1;
   const b = 2;
-  return a + b;
+  const c = 3;
+  return a + b + c;
 }
`;

const ADDED = `diff --git a/NEW.md b/NEW.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/NEW.md
@@ -0,0 +1,2 @@
+hello
+world
`;

const DELETED = `diff --git a/OLD.md b/OLD.md
deleted file mode 100644
index 4444444..0000000
--- a/OLD.md
+++ /dev/null
@@ -1,2 +0,0 @@
-gone
-forever
`;

const RENAMED = `diff --git a/old/name.ts b/new/name.ts
similarity index 92%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,3 +1,3 @@
 keep
-was
+now
`;

const BINARY = `diff --git a/logo.png b/logo.png
index 5555555..6666666 100644
Binary files a/logo.png and b/logo.png differ
`;

describe('Unified diff parsing', () => {
  test('1. Modified file tracks both line numbers', () => {
    const [file] = parseUnifiedDiff(MODIFIED);
    assert.ok(file);
    assert.strictEqual(file.path, 'src/app.ts');
    assert.strictEqual(file.status, 'modified');
    assert.strictEqual(file.additions, 2);
    assert.strictEqual(file.deletions, 1);
    assert.strictEqual(file.hunks.length, 1);

    const hunk = file.hunks[0]!;
    assert.strictEqual(hunk.oldStart, 10);
    assert.strictEqual(hunk.newStart, 10);
    assert.strictEqual(hunk.header, 'export function boot() {');

    const del = hunk.lines.find((l) => l.kind === 'del')!;
    assert.strictEqual(del.text, '  return a + b;');
    assert.strictEqual(del.oldLine, 12);
    assert.strictEqual(del.newLine, undefined);

    const firstAdd = hunk.lines.find((l) => l.kind === 'add')!;
    assert.strictEqual(firstAdd.newLine, 12);
    assert.strictEqual(firstAdd.oldLine, undefined);

    // Context after the edit stays aligned on both sides.
    const tail = hunk.lines.at(-1)!;
    assert.strictEqual(tail.kind, 'ctx');
    assert.strictEqual(tail.oldLine, 13);
    assert.strictEqual(tail.newLine, 14);
  });

  test('2. Added and deleted files keep a usable path', () => {
    const [added] = parseUnifiedDiff(ADDED);
    assert.strictEqual(added!.status, 'added');
    assert.strictEqual(added!.path, 'NEW.md');
    assert.strictEqual(added!.additions, 2);

    const [deleted] = parseUnifiedDiff(DELETED);
    assert.strictEqual(deleted!.status, 'deleted');
    assert.strictEqual(deleted!.path, 'OLD.md');
    assert.strictEqual(deleted!.deletions, 2);
  });

  test('3. Renames record both sides', () => {
    const [file] = parseUnifiedDiff(RENAMED);
    assert.strictEqual(file!.status, 'renamed');
    assert.strictEqual(file!.path, 'new/name.ts');
    assert.strictEqual(file!.oldPath, 'old/name.ts');
  });

  test('4. Binary files are flagged, not parsed', () => {
    const [file] = parseUnifiedDiff(BINARY);
    assert.strictEqual(file!.binary, true);
    assert.strictEqual(file!.hunks.length, 0);
    assert.strictEqual(fileStatLabel(file!), 'binary');
  });

  test('5. Multi-file patches split cleanly and total up', () => {
    const files = parseUnifiedDiff([MODIFIED, ADDED, DELETED].join(''));
    assert.strictEqual(files.length, 3);
    assert.deepStrictEqual(
      files.map((f) => f.path),
      ['src/app.ts', 'NEW.md', 'OLD.md']
    );
    assert.deepStrictEqual(diffStat(files), { files: 3, additions: 4, deletions: 3 });
  });

  test('6. Paths containing spaces survive', () => {
    const files = parseUnifiedDiff(`diff --git a/my docs/a b.md b/my docs/a b.md
--- a/my docs/a b.md
+++ b/my docs/a b.md
@@ -1 +1 @@
-x
+y
`);
    assert.strictEqual(files[0]!.path, 'my docs/a b.md');
  });

  test('7. "No newline at end of file" is not a diff row', () => {
    const [file] = parseUnifiedDiff(`diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
\\ No newline at end of file
+new
`);
    assert.strictEqual(file!.additions, 1);
    assert.strictEqual(file!.deletions, 1);
    assert.strictEqual(file!.hunks[0]!.lines.length, 2);
  });

  test('8. Empty and junk input never throws', () => {
    assert.deepStrictEqual(parseUnifiedDiff(''), []);
    assert.deepStrictEqual(parseUnifiedDiff('   \n  '), []);
    assert.deepStrictEqual(parseUnifiedDiff('not a diff at all'), []);
    assert.deepStrictEqual(diffStat([]), { files: 0, additions: 0, deletions: 0 });
  });
});

test('the header counts every folder a task worked in', () => {
  // Two repositories, one task: the totals over the tab are the whole of it.
  assert.deepStrictEqual(
    sumDiffStats([
      { files: 2, additions: 10, deletions: 3 },
      { files: 1, additions: 4, deletions: 0 }
    ]),
    { files: 3, additions: 14, deletions: 3 }
  );
  assert.deepStrictEqual(sumDiffStats([]), { files: 0, additions: 0, deletions: 0 });
});
