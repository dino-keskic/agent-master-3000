import test from 'node:test';
import assert from 'node:assert';
import { mapLimit } from '../../shared/mapLimit.js';

test('mapLimit keeps input order and caps how many run at once', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return n * 10;
  });
  assert.deepStrictEqual(out, [10, 20, 30, 40, 50]);
  assert.strictEqual(peak, 2);
  assert.deepStrictEqual(await mapLimit([], 2, () => Promise.resolve(1)), []);
});
