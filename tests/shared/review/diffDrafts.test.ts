import test from 'node:test';
import assert from 'node:assert';
import { draftKey, firstChangedLine, lineDraft } from '../../../shared/review/diffDrafts.js';
import { DiffFile, DiffHunk, DiffLine } from '../../../shared/git/diff.js';

function hunk(lines: DiffLine[]): DiffHunk {
  return { header: '', oldStart: 1, newStart: 1, lines };
}

function file(hunks: DiffHunk[]): DiffFile {
  return { path: 'src/app.ts', status: 'modified', additions: 0, deletions: 0, binary: false, hunks };
}

test('anchoring a review note to a diff line', async (t) => {
  const added: DiffLine = { kind: 'add', text: 'const next = 1;', newLine: 12 };
  const deleted: DiffLine = { kind: 'del', text: 'const next = 0;', oldLine: 12 };

  await t.test('quotes the line, with the marker it is shown by', () => {
    assert.strictEqual(lineDraft('a.ts', added).snippet, '+const next = 1;');
    assert.strictEqual(lineDraft('a.ts', deleted).snippet, '-const next = 0;');
    assert.strictEqual(lineDraft('a.ts', { kind: 'ctx', text: 'kept', oldLine: 3, newLine: 3 }).snippet, ' kept');
  });

  await t.test('an addition and the deletion it replaced are two rows', () => {
    assert.notStrictEqual(draftKey(lineDraft('a.ts', added)), draftKey(lineDraft('a.ts', deleted)));
  });

  await t.test('the same line in two files is two rows', () => {
    assert.notStrictEqual(draftKey(lineDraft('a.ts', added)), draftKey(lineDraft('b.ts', added)));
  });

  await t.test('a note on the whole file has one anchor of its own', () => {
    assert.strictEqual(draftKey({ path: 'a.ts', side: 'file', snippet: '' }), ':a.ts:file');
  });

  await t.test('the same line in two checkouts is two rows', () => {
    assert.notStrictEqual(
      draftKey(lineDraft('a.ts', added, '/code/app')),
      draftKey(lineDraft('a.ts', added, '/code/app.worktrees/fix'))
    );
    assert.strictEqual(lineDraft('a.ts', added, '/code/app').cwd, '/code/app');
  });
});

test('opening a file at its first change', async (t) => {
  await t.test('skips the context above it', () => {
    const changed = file([hunk([
      { kind: 'ctx', text: 'a', oldLine: 40, newLine: 40 },
      { kind: 'add', text: 'b', newLine: 41 }
    ])]);
    assert.strictEqual(firstChangedLine(changed), 41);
  });

  await t.test('falls back to the old line when the change is a deletion', () => {
    const removed = file([hunk([{ kind: 'del', text: 'gone', oldLine: 7 }])]);
    assert.strictEqual(firstChangedLine(removed), 7);
  });

  await t.test('has no line to open when nothing changed', () => {
    assert.strictEqual(firstChangedLine(file([hunk([{ kind: 'ctx', text: 'a', oldLine: 1, newLine: 1 }])])), undefined);
    assert.strictEqual(firstChangedLine(file([])), undefined);
  });
});
