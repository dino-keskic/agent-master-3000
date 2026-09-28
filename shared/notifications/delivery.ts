import { NotificationSettings } from '../types.js';
import type { DesktopNotification } from './notifications.js';
import { resolveNotificationSettings } from './settings.js';

/**
 * Whether an alert can reach you, and what to say when it did not.
 *
 * The browser owns the permission and the OS owns the banner; this names the
 * states in between so the panel and the header can point at the one that is
 * in the way. `src/app/notifications/` is what actually asks the browser.
 */

/**
 * How a `showNotification` attempt ended.
 *
 * The board used to swallow every one of these: no permission, a worker that
 * would not register, a browser that threw — all of them returned quietly, so
 * "Send a test" and "an agent needs you" failed the same silent way. The
 * outcome is a value now, and `describeDelivery` is what the panel says about
 * it.
 */
export type NotificationDelivery =
  | { ok: true; shown: number }
  | { ok: false; reason: 'unsupported' | 'denied' | 'default' | 'failed'; detail?: string };

/**
 * What to tell the user about an attempt.
 *
 * `ok` is deliberately not "it worked": the browser accepting a notification
 * and the OS drawing a banner are two different things, and on macOS a Focus
 * mode or a per-app setting silently eats the second one. Saying where to look
 * is the only honest answer the page can give.
 */
export function describeDelivery(result: NotificationDelivery): { tone: 'ok' | 'warn'; text: string } {
  if (result.ok) {
    return {
      tone: 'ok',
      text: 'Sent. If no banner appeared, the OS is holding it back — check your notification settings for this browser, and any Do Not Disturb or Focus mode.'
    };
  }
  switch (result.reason) {
    case 'unsupported':
      return { tone: 'warn', text: 'This browser cannot show desktop notifications.' };
    case 'denied':
      return {
        tone: 'warn',
        text: 'The browser is blocking notifications for this site. Allow them in the site settings next to the address bar, then try again.'
      };
    case 'default':
      return { tone: 'warn', text: 'The browser has not been asked yet — turn on Desktop notifications above.' };
    default:
      return {
        tone: 'warn',
        text: result.detail || 'The browser refused the notification.'
      };
  }
}

/**
 * The sample notification, tagged with the moment it was asked for.
 *
 * A fixed tag is why pressing "Send a test" twice looked broken: macOS updates
 * the notification already sitting in Notification Center instead of alerting
 * again, so every press after the first was invisible.
 */
export function testNotification(now: number): DesktopNotification {
  return {
    tag: `agent-master-3000:test:${now}`,
    title: 'Agent Master 3000 is watching',
    body: 'You will get a notification when an agent needs you or a turn finishes.'
  };
}

/** What the browser says about notifications for this origin. */
export type DesktopPermission = NotificationPermission | 'unsupported';

/**
 * Whether desktop alerts will actually reach you, in this browser.
 *
 * `enabled` is a board setting, saved on the server, while the permission
 * belongs to the browser and the origin. They drift apart: a second browser, a
 * `localhost` tab next to a `127.0.0.1` one, or Chrome quietly revoking the
 * grant from a site that sends a lot of notifications. Every alert then fails
 * with "no permission" and nothing on screen said so, because the switch
 * still read as on. `needs-permission` and `blocked` are that state, named so
 * the header can point at it.
 */
export type DesktopAlertState = 'off' | 'on' | 'needs-permission' | 'blocked' | 'unsupported';

export function desktopAlertState(
  settings: Partial<NotificationSettings> | undefined,
  permission: DesktopPermission
): DesktopAlertState {
  if (!resolveNotificationSettings(settings).enabled) return 'off';
  switch (permission) {
    case 'granted':
      return 'on';
    case 'denied':
      return 'blocked';
    case 'unsupported':
      return 'unsupported';
    default:
      return 'needs-permission';
  }
}

/** What the header says about a state that is not delivering. Undefined when there is nothing to fix. */
export function desktopAlertWarning(state: DesktopAlertState): string | undefined {
  switch (state) {
    case 'needs-permission':
      return 'Desktop alerts are on, but this browser has not allowed them for this address. Open Notifications to allow them.';
    case 'blocked':
      return 'Desktop alerts are on, but this browser is blocking them for this address. Allow notifications in the site settings next to the address bar.';
    default:
      return undefined;
  }
}
