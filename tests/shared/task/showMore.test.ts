import test from 'node:test';
import assert from 'node:assert';
import { collapseToRecent } from '../../../shared/task/showMore.js';

interface Row { id: string; at: number; pinned?: boolean }
const rows = (...ats: number[]): Row[] => ats.map((at, i) => ({ id: `r${i}`, at }));
const ids = (list: Row[]) => list.map((row) => row.id);
const addedAt = (row: Row) => row.at;

test('collapseToRecent shows everything while the list is short', () => {
  const list = rows(1, 2, 3, 4);
  assert.deepStrictEqual(collapseToRecent(list, { addedAt }), { visible: list, hiddenCount: 0 });
});

test('collapseToRecent never folds away a single row', () => {
  const result = collapseToRecent(rows(1, 2, 3, 4, 5), { addedAt });
  assert.strictEqual(result.hiddenCount, 0);
  assert.strictEqual(result.visible.length, 5);
});

test('collapseToRecent keeps the newest rows, in their list order', () => {
  // Out of time order, as a list sorted by kind would be.
  const result = collapseToRecent(rows(50, 10, 60, 20, 70, 30, 40), { addedAt });
  assert.deepStrictEqual(ids(result.visible), ['r0', 'r2', 'r4', 'r6']);
  assert.strictEqual(result.hiddenCount, 3);
});

test('collapseToRecent breaks ties by position, later being newer', () => {
  const result = collapseToRecent(rows(0, 0, 0, 0, 0, 0), { addedAt, limit: 2 });
  assert.deepStrictEqual(ids(result.visible), ['r4', 'r5']);
});

test('collapseToRecent keeps pinned rows however old they are', () => {
  const list = rows(1, 2, 3, 4, 5, 6, 7, 8);
  list[0]!.pinned = true;
  const result = collapseToRecent(list, { addedAt, keep: (row) => !!row.pinned });
  assert.deepStrictEqual(ids(result.visible), ['r0', 'r4', 'r5', 'r6', 'r7']);
  assert.strictEqual(result.hiddenCount, 3);
});

test('collapseToRecent shows everything when pinning leaves one row hidden', () => {
  const list = rows(1, 2, 3, 4, 5, 6);
  list[0]!.pinned = true;
  assert.strictEqual(collapseToRecent(list, { addedAt, keep: (row) => !!row.pinned }).hiddenCount, 0);
});
