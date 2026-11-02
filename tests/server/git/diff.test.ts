import test from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { taskDiff } from '../../../server/git/diff.js';

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-diff-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
  return dir;
}

test('untracked files show as additions, the way git would show them', async () => {
  const dir = repo();
  try {
    fs.writeFileSync(path.join(dir, 'notes.md'), 'one\ntwo\n');
    fs.writeFileSync(path.join(dir, 'tail.txt'), 'no newline');
    fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 0, 2]));
    fs.writeFileSync(path.join(dir, 'empty'), '');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored.log\n');
    fs.writeFileSync(path.join(dir, 'ignored.log'), 'skip me\n');

    const diff = await taskDiff(dir, 'uncommitted');
    const byPath = new Map(diff.files.map((file) => [file.path, file]));
    assert.deepStrictEqual([...byPath.keys()].sort(), ['.gitignore', 'blob.bin', 'empty', 'notes.md', 'tail.txt']);
    assert.strictEqual(byPath.get('notes.md')!.additions, 2);
    assert.strictEqual(byPath.get('tail.txt')!.hunks[0]!.lines[0]!.text, 'no newline');
    assert.strictEqual(byPath.get('blob.bin')!.binary, true);
    assert.strictEqual(byPath.get('empty')!.additions, 0);
    assert.ok([...byPath.values()].every((file) => file.status === 'added'));
    assert.deepStrictEqual(diff.stat, { files: 5, additions: 4, deletions: 0 });
    assert.strictEqual(diff.truncated, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
