import test from 'node:test';
import assert from 'node:assert';
import { shouldNotify } from '../../../shared/notifications/settings.js';

test('shouldNotify respects the master switch and the unfocused default', () => {
  assert.strictEqual(shouldNotify('turn_complete', undefined, false), false);
  assert.strictEqual(shouldNotify('turn_complete', { enabled: true }, true), false);
  assert.strictEqual(shouldNotify('turn_complete', { enabled: true }, false), true);
  assert.strictEqual(
    shouldNotify('turn_complete', { enabled: true, onlyWhenUnfocused: false }, true),
    true
  );
  assert.strictEqual(
    shouldNotify('awaiting_input', { enabled: true, awaitingInput: false }, false),
    false
  );
});
