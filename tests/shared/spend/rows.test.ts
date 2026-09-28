import test from 'node:test';
import assert from 'node:assert';
import { FOLDED_ROW_KEY, defaultSpendGroup, spendGroups, spendRows } from '../../../shared/spend/rows.js';

const bucket = (key: string, cost: number, tokens?: number) => ({ key, label: key, cost, tokens });

test('rows add up to the total and carry their share of it', () => {
  const rows = spendRows([bucket('a', 3.84352), bucket('b', 1.426885), bucket('c', 0.106801)], 5.38, { limit: 5 });
  assert.deepStrictEqual(rows.map((r) => r.cost), [3.84, 1.43, 0.11]);
  assert.deepStrictEqual(rows.map((r) => r.share), [71, 27, 2]);
});

test('a long ranked tail folds into one row, keeping the sum', () => {
  const buckets = [bucket('a', 4, 100), bucket('b', 2, 50), bucket('c', 1, 10), bucket('d', 0.5, 5), bucket('e', 0.5)];
  const rows = spendRows(buckets, 8, { limit: 3 });
  assert.deepStrictEqual(rows.map((r) => r.key), ['a', 'b', FOLDED_ROW_KEY]);
  assert.strictEqual(rows[2]?.label, '3 more');
  assert.strictEqual(rows[2]?.cost, 2);
  assert.strictEqual(rows[2]?.tokens, 15);
  assert.strictEqual(rows[2]?.folded, true);
  assert.strictEqual(rows[0]?.folded, undefined);
});

test('phases never fold, and a free stage keeps its row with no bar', () => {
  const buckets = [bucket('plan', 0), bucket('exec', 1), bucket('review', 0.5), bucket('fix', 0.25)];
  const rows = spendRows(buckets, 1.75, { limit: 2, fold: false });
  assert.deepStrictEqual(rows.map((r) => r.key), ['plan', 'exec', 'review', 'fix']);
  assert.strictEqual(rows[0]?.share, 0);
});

test('nothing to show is no rows, and a zero total draws no bars', () => {
  assert.deepStrictEqual(spendRows([], 1, { limit: 5 }), []);
  assert.deepStrictEqual(spendRows([bucket('a', 0)], 0, { limit: 5 }).map((r) => r.share), [0]);
});

test('the breakdown opens on the first split that divides the money', () => {
  const one = [bucket('x', 1)];
  const two = [bucket('x', 1), bucket('y', 1)];
  assert.strictEqual(defaultSpendGroup({ byPhase: one, byModel: two, byAgent: two }), 'model');
  assert.strictEqual(defaultSpendGroup({ byPhase: one, byModel: one, byAgent: one }), 'phase');
  assert.strictEqual(defaultSpendGroup({ byPhase: [], byModel: one, byAgent: [] }), 'model');
  assert.strictEqual(defaultSpendGroup({ byPhase: [], byModel: [], byAgent: [] }), 'phase');
  assert.deepStrictEqual(spendGroups({ byPhase: [], byModel: one, byAgent: two }).map((g) => g.group), ['model', 'agent']);
});
