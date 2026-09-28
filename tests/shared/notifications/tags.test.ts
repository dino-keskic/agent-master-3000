import test from 'node:test';
import assert from 'node:assert';
import { freshNotificationTag, notificationTag, notificationTagMatches } from '../../../shared/notifications/tags.js';

test('a fresh tag alerts again, and closing the old one does not close the new one', () => {
  const logical = notificationTag('TASK-1', 'ses_a');
  const first = freshNotificationTag(logical, 1000, 1);
  const second = freshNotificationTag(logical, 1000, 2);
  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first, logical);
  // The banner just raised is excluded; the previous one for the session is not.
  assert.strictEqual(notificationTagMatches(second, logical, logical, second), false);
  assert.strictEqual(notificationTagMatches(first, logical, logical, second), true);
  // A tag from before fresh tags existed is still the same session.
  assert.strictEqual(notificationTagMatches(logical, undefined, logical), true);
  // TASK-1 must not eat TASK-10, and one session must not eat another.
  const other = freshNotificationTag(notificationTag('TASK-10', 'ses_a'), 1000, 1);
  assert.strictEqual(notificationTagMatches(other, notificationTag('TASK-10', 'ses_a'), logical), false);
  const sibling = freshNotificationTag(notificationTag('TASK-1', 'ses_b'), 1000, 1);
  assert.strictEqual(notificationTagMatches(sibling, notificationTag('TASK-1', 'ses_b'), logical), false);
});
