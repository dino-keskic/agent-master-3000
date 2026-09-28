import test, { describe } from 'node:test';
import assert from 'node:assert';
import { changeFilesFromStat } from '../../../shared/git/diffStat.js';

describe('git numstat joined to name-status', () => {
  test('added, deleted, modified, rename and a path with a space', () => {
    const nameStatus = ['A', 'src/added.ts', 'D', 'src/del.ts', 'M', 'src/mod.ts', 'R066', 'src/old.ts', 'src/new.ts', 'A', 'weird name/file.ts', ''].join('\0');
    const numstat = [
      '2\t0\tsrc/added.ts\0',
      '0\t1\tsrc/del.ts\0',
      '2\t0\tsrc/mod.ts\0',
      '1\t0\t\0src/old.ts\0src/new.ts\0',
      '1\t0\tweird name/file.ts\0'
    ].join('');

    assert.deepStrictEqual(changeFilesFromStat(nameStatus, numstat), [
      { path: 'src/added.ts', status: 'added', additions: 2, deletions: 0, binary: false },
      { path: 'src/del.ts', status: 'deleted', additions: 0, deletions: 1, binary: false },
      { path: 'src/mod.ts', status: 'modified', additions: 2, deletions: 0, binary: false },
      { path: 'src/new.ts', oldPath: 'src/old.ts', status: 'renamed', additions: 1, deletions: 0, binary: false },
      { path: 'weird name/file.ts', status: 'added', additions: 1, deletions: 0, binary: false }
    ]);
  });

  test('a binary file and a copy, and an empty diff', () => {
    const nameStatus = ['M', 'assets/pic.png', 'C100', 'src/old.ts', 'src/copy.ts', ''].join('\0');
    const numstat = '-\t-\tassets/pic.png\0' + '3\t0\t\0src/old.ts\0src/copy.ts\0';
    assert.deepStrictEqual(changeFilesFromStat(nameStatus, numstat), [
      { path: 'assets/pic.png', status: 'modified', additions: 0, deletions: 0, binary: true },
      { path: 'src/copy.ts', status: 'added', additions: 3, deletions: 0, binary: false }
    ]);
    assert.deepStrictEqual(changeFilesFromStat('', ''), []);
  });
});
