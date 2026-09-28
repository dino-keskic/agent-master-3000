import test from 'node:test';
import assert from 'node:assert';
import { LIVE_TURN_SILENCE_MS, isAbandonedTurn } from '../../../shared/turns/abandoned.js';

const NOW = 2_000_000_000_000;

test('isAbandonedTurn', async (t) => {
  await t.test('a turn that wrote a minute ago is live', () => {
    assert.strictEqual(isAbandonedTurn(NOW - 60_000, NOW), false);
  });

  await t.test('a turn silent past the window is wreckage', () => {
    assert.strictEqual(isAbandonedTurn(NOW - LIVE_TURN_SILENCE_MS - 1, NOW), true);
    assert.strictEqual(isAbandonedTurn(NOW - LIVE_TURN_SILENCE_MS, NOW), false);
  });

  await t.test('a session with no write at all is wreckage', () => {
    assert.strictEqual(isAbandonedTurn(undefined, NOW), true);
  });

  await t.test('a turn last written before the board started died with it', () => {
    const startedAt = NOW - 5_000;
    assert.strictEqual(isAbandonedTurn(NOW - 30_000, NOW, startedAt), true, 'the Ctrl-C case: seconds old, but from the old board');
    assert.strictEqual(isAbandonedTurn(NOW - 1_000, NOW, startedAt), false, 'written since the restart, so something is driving it');
    assert.strictEqual(isAbandonedTurn(startedAt, NOW, startedAt), false);
  });
});
