import test from 'node:test';
import assert from 'node:assert';
import {
  describeDelivery,
  desktopAlertState,
  desktopAlertWarning,
  testNotification
} from '../../../shared/notifications/delivery.js';

/**
 * Why the board went quiet. Every one of these used to come back as silence,
 * which is what made "send a test does nothing" impossible to act on.
 */
test('a refused notification says which refusal it was', () => {
  assert.match(describeDelivery({ ok: false, reason: 'denied' }).text, /blocking notifications/);
  assert.match(describeDelivery({ ok: false, reason: 'default' }).text, /not been asked/);
  assert.match(describeDelivery({ ok: false, reason: 'unsupported' }).text, /cannot show/);
  assert.match(
    describeDelivery({ ok: false, reason: 'failed', detail: 'Illegal constructor' }).text,
    /Illegal constructor/
  );
  for (const reason of ['denied', 'default', 'unsupported', 'failed'] as const) {
    assert.strictEqual(describeDelivery({ ok: false, reason }).tone, 'warn');
  }
});

test('a notification the browser accepted is not claimed to have been seen', () => {
  const { tone, text } = describeDelivery({ ok: true, shown: 1 });
  assert.strictEqual(tone, 'ok');
  // The browser taking it and the OS drawing it are different things, and the
  // page cannot tell — so it says where the banner would have been eaten.
  assert.match(text, /Do Not Disturb|Focus/);
});

test('each test notification is its own banner', () => {
  // macOS updates a notification already in Notification Center instead of
  // alerting again, so a fixed tag made every press after the first invisible.
  assert.notStrictEqual(testNotification(1000).tag, testNotification(2000).tag);
  assert.ok(testNotification(1000).title);
  assert.ok(testNotification(1000).body);
});

test('desktopAlertState tells a switch that is on apart from alerts that arrive', () => {
  const on = { enabled: true };
  assert.strictEqual(desktopAlertState(on, 'granted'), 'on');
  // The setting lives on the server; the grant is this browser's, for this address.
  assert.strictEqual(desktopAlertState(on, 'default'), 'needs-permission');
  assert.strictEqual(desktopAlertState(on, 'denied'), 'blocked');
  assert.strictEqual(desktopAlertState(on, 'unsupported'), 'unsupported');
  // Switched off, the browser's answer does not matter.
  assert.strictEqual(desktopAlertState({ enabled: false }, 'granted'), 'off');
  assert.strictEqual(desktopAlertState(undefined, 'denied'), 'off');
});

test('desktopAlertWarning speaks only when alerts are on and cannot arrive', () => {
  assert.match(desktopAlertWarning('needs-permission') ?? '', /has not allowed/);
  assert.match(desktopAlertWarning('blocked') ?? '', /blocking/);
  assert.strictEqual(desktopAlertWarning('on'), undefined);
  assert.strictEqual(desktopAlertWarning('off'), undefined);
  assert.strictEqual(desktopAlertWarning('unsupported'), undefined);
});
