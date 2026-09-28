import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { scoreFilePath, searchFiles } from '../../../server/git/files.js';

function best(paths: string[], query: string): string[] {
  return paths
    .map((p) => ({ p, score: scoreFilePath(p, query) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p))
    .map((row) => row.p);
}

test('a hit on the file name beats a hit on the folders above it', () => {
  const ranked = best(['src/composer/index.ts', 'src/components/Composer.tsx'], 'composer');
  assert.strictEqual(ranked[0], 'src/components/Composer.tsx');
});

test('shorter, shallower paths come first among equal matches', () => {
  const ranked = best(['a/b/c/d/api.ts', 'src/api.ts'], 'api.ts');
  assert.strictEqual(ranked[0], 'src/api.ts');
});

test('a scattered subsequence still matches, but ranks last', () => {
  const ranked = best(['src/components/Composer.tsx', 'src/cmpsr.ts', 'docs/notes.md'], 'cmpsr');
  assert.deepStrictEqual(ranked, ['src/cmpsr.ts', 'src/components/Composer.tsx']);
});

test('nothing matching scores below zero rather than sneaking in', () => {
  assert.ok(scoreFilePath('src/api.ts', 'zzzzz') < 0);
});

test('an empty query lists files, shortest first', () => {
  const ranked = best(['a/very/deep/nested/file.ts', 'app.ts'], '');
  assert.strictEqual(ranked[0], 'app.ts');
});

test('searchFiles walks a plain folder and skips the noise', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-files-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'api.ts'), '');
  fs.writeFileSync(path.join(root, 'node_modules', 'left-pad', 'index.js'), '');

  const { items } = await searchFiles(root, '');
  const paths = items.map((item) => item.path);
  assert.ok(paths.includes('src/api.ts'));
  assert.ok(!paths.some((p) => p.startsWith('node_modules')), `node_modules leaked: ${paths.join(', ')}`);
  assert.strictEqual(items.find((item) => item.path === 'src/api.ts')?.name, 'api.ts');
});

test('searchFiles reports a missing folder instead of throwing', async () => {
  const { items } = await searchFiles(path.join(os.tmpdir(), 'acp-files-nope'), 'x');
  assert.deepStrictEqual(items, []);
});

test('a subsequence spread across the folders above does not count as a match', () => {
  // `.vscode/MySports.code-workspace` spells out "compos" if you let the whole
  // path play; over the name alone it does not, and the menu stays useful.
  assert.ok(scoreFilePath('.vscode/MySports.code-workspace', 'compos') < 0);
});
