import { NotificationDelivery, testNotification } from '../../../shared/notifications/delivery';
import { DesktopNotification } from '../../../shared/notifications/notifications';
import { freshNotificationTag, notificationTag, notificationTagMatches } from '../../../shared/notifications/tags';
import { isDocumentFocused } from './page';

/**
 * Raising and closing desktop notifications: the only code allowed to touch
 * the browser Notification API and the notification service worker. What to
 * raise, and when, is decided in `shared/notifications/` so it can be tested
 * without a window.
 */

const WORKER_URL = '/notification-sw.js';
const CLICK_MESSAGE = 'agent-master-3000:notification-click';

type NotificationClickHandler = (taskId?: string, sessionId?: string) => void;

let clickHandler: NotificationClickHandler | undefined;
let workerMessageBound = false;

export function setNotificationClickHandler(handler: NotificationClickHandler): void {
  clickHandler = handler;
}

function onWorkerMessage(event: MessageEvent): void {
  const data = event.data as { type?: string; taskId?: string; sessionId?: string } | null;
  if (!data || data.type !== CLICK_MESSAGE) return;
  window.focus();
  clickHandler?.(data.taskId, data.sessionId);
}

/**
 * Register the notification worker. Page-level `new Notification()` does not
 * appear in macOS Notification Center while Chrome is in the background;
 * `ServiceWorkerRegistration.showNotification()` does.
 */
export function registerNotificationWorker(): void {
  if (typeof navigator === 'undefined') return;
  try {
    if (!workerMessageBound) {
      navigator.serviceWorker.addEventListener('message', onWorkerMessage);
      workerMessageBound = true;
    }
    void navigator.serviceWorker.register(WORKER_URL, { scope: '/', updateViaCache: 'none' }).catch((err) => {
      console.warn('Notification worker failed to register:', err);
    });
  } catch (err) {
    console.warn('Notification worker failed to register:', err);
  }
}

async function notificationRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined') return undefined;
  try {
    // An already-active worker. Registering again here would kick off an
    // update, and a worker swap in the middle of showNotification drops it.
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    registerNotificationWorker();
    const ready = navigator.serviceWorker.ready;
    const gaveUp = new Promise<undefined>((resolve) => {
      window.setTimeout(() => resolve(undefined), 1500);
    });
    const registration = await Promise.race([ready, gaveUp]);
    return registration?.showNotification ? registration : undefined;
  } catch {
    return undefined;
  }
}

/** Splits two alerts in one millisecond. Resets on reload; the timestamp does not. */
let noticeSeq = 0;

function nextDisplayTag(logicalTag: string): string {
  noticeSeq += 1;
  return freshNotificationTag(logicalTag, Date.now(), noticeSeq);
}

function storedLogicalTag(notification: Notification): string | undefined {
  const data = notification.data as { logicalTag?: string } | undefined;
  return data?.logicalTag;
}

const openByTag = new Map<string, Notification>();
/** The banner that should stay up for a logical tag. A late cleanup must not close a newer one. */
const latestDisplayTag = new Map<string, string>();

/** macOS needs a moment to admit the new banner exists before an older one is closed. */
const RETIRE_DELAY_MS = 100;

function messageOf(err: unknown): string {
  return (err as { message?: string } | undefined)?.message || String(err);
}

/** Page-level fallback. macOS will not banner this while Chrome is backgrounded. */
function showOnPage(item: DesktopNotification, options: NotificationOptions): void {
  const previous = openByTag.get(item.tag);
  const notification = new Notification(item.title, options);
  openByTag.set(item.tag, notification);
  previous?.close();
  notification.onclick = () => {
    window.focus();
    clickHandler?.(item.taskId, item.sessionId);
    notification.close();
  };
  notification.onclose = () => {
    if (openByTag.get(item.tag) === notification) openByTag.delete(item.tag);
  };
}

/**
 * Drop older banners for this session, not the one just raised.
 *
 * Closing the previous notification *before* showing the next one, under the
 * same tag, is what made the replacement vanish: macOS applies the close to
 * the tag, and the new banner is that tag. The new one goes up under a fresh
 * tag first; anything older for the session is closed afterwards.
 */
async function retireOlder(registration: ServiceWorkerRegistration, logicalTag: string): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, RETIRE_DELAY_MS);
  });
  const keep = latestDisplayTag.get(logicalTag);
  try {
    const shown = await registration.getNotifications();
    for (const notification of shown) {
      if (notificationTagMatches(notification.tag, storedLogicalTag(notification), logicalTag, keep)) {
        notification.close();
      }
    }
  } catch {
    /* Best effort — a browser without getNotifications still gets the new one. */
  }
}

/**
 * Raise these notifications, and say how it went.
 *
 * Every failure here used to be a quiet `return` or a `console.warn`: no
 * permission, no worker, a browser that threw. From the panel all three looked
 * exactly like a button that does nothing, which is how "notifications are
 * broken" stayed un-diagnosable. The outcome comes back so the panel can say
 * which of them happened.
 */
export async function showDesktopNotifications(
  items: DesktopNotification[],
  onOpen?: NotificationClickHandler
): Promise<NotificationDelivery> {
  if (typeof Notification === 'undefined') return { ok: false, reason: 'unsupported' };
  if (Notification.permission !== 'granted') {
    return { ok: false, reason: Notification.permission === 'denied' ? 'denied' : 'default' };
  }
  if (items.length === 0) return { ok: true, shown: 0 };
  if (onOpen) clickHandler = onOpen;

  const prepared = items.map((item) => {
    const displayTag = nextDisplayTag(item.tag);
    latestDisplayTag.set(item.tag, displayTag);
    const options = {
      body: item.body,
      tag: displayTag,
      data: { taskId: item.taskId, sessionId: item.sessionId, logicalTag: item.tag }
    } as NotificationOptions;
    return { item, options };
  });

  // A test is clicked with this window in front. `new Notification()` is
  // attempted first, synchronously, because that is the call macOS will
  // banner while Chrome is the active app — but on current Chrome it often
  // returns without throwing and without drawing anything once a service
  // worker is registered. Stopping there is why Send a test did nothing.
  // The worker notification is always raised as well, and a test is
  // requireInteraction so it stays up instead of being a banner Chrome is
  // allowed to swallow while its own window is focused.
  const focused = isDocumentFocused();
  let shown = 0;
  let failure: string | undefined;

  if (focused) {
    for (const entry of prepared) {
      try {
        // Not counted as success. Chrome returns from this constructor without
        // throwing and without drawing anything once the worker is registered.
        showOnPage(entry.item, entry.options);
      } catch (err) {
        failure = messageOf(err);
        console.warn('Desktop notification failed:', err);
      }
    }
  }

  const registration = await notificationRegistration();
  for (const entry of prepared) {
    const isTest = entry.item.tag.startsWith('agent-master-3000:test:');
    if (isTest) entry.options.requireInteraction = true;
    try {
      if (!registration?.showNotification) {
        failure = failure || 'The notification worker is not running. Reload the board and try again.';
        if (!focused) {
          showOnPage(entry.item, entry.options);
          shown++;
        }
        continue;
      }
      await registration.showNotification(entry.item.title, entry.options);
      if (!isTest) void retireOlder(registration, entry.item.tag);
      const tag = entry.options.tag || '';
      // macOS can take a moment to admit the notification exists. Checking
      // immediately reports a failure for a banner that is about to appear.
      let listed = await registration.getNotifications({ tag });
      if (listed.length === 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 200));
        listed = await registration.getNotifications({ tag });
      }
      if (listed.length === 0) {
        failure =
          'Chrome dropped it before it could be shown. In System Settings, open Notifications, select Google Chrome, and turn on Allow Notifications, Banners, and Alerts.';
        continue;
      }
      shown++;
    } catch (err) {
      failure = messageOf(err);
      console.warn('Service worker notification failed:', err);
      if (focused) continue;
      try {
        showOnPage(entry.item, entry.options);
        shown++;
      } catch (pageErr) {
        failure = messageOf(pageErr);
        console.warn('Desktop notification failed:', pageErr);
      }
    }
  }

  return shown > 0 ? { ok: true, shown } : { ok: false, reason: 'failed', detail: failure };
}

function tagBelongsToTask(tag: string, taskId: string): boolean {
  const prefix = notificationTag(taskId);
  return tag === prefix || tag.startsWith(`${prefix}:`);
}

/**
 * Close OS banners for these tags. Dropping an inbox row is what drives this
 * — a toast whose session is no longer in the list should not linger.
 */
export async function closeDesktopNotifications(tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const wanted = new Set(tags);
  for (const tag of wanted) {
    const open = openByTag.get(tag);
    if (!open) continue;
    open.close();
    openByTag.delete(tag);
  }
  try {
    const registration = await notificationRegistration();
    if (!registration) return;
    const shown = await registration.getNotifications();
    for (const notification of shown) {
      const logical = storedLogicalTag(notification);
      if ([...wanted].some((tag) => notificationTagMatches(notification.tag, logical, tag))) {
        notification.close();
      }
    }
  } catch {
    /* Closing is best-effort — a missing worker should not break the inbox. */
  }
}

/** Opening a task has already shown you what happened; dismiss its toasts. */
export async function closeDesktopNotificationsForTask(taskId: string): Promise<void> {
  for (const [tag, notification] of [...openByTag]) {
    if (!tagBelongsToTask(tag, taskId)) continue;
    notification.close();
    openByTag.delete(tag);
  }
  try {
    const registration = await notificationRegistration();
    if (!registration) return;
    const shown = await registration.getNotifications();
    for (const notification of shown) {
      const data = notification.data as { taskId?: string } | undefined;
      if (data?.taskId === taskId || tagBelongsToTask(notification.tag, taskId)) {
        notification.close();
      }
    }
  } catch {
    /* Closing is best-effort. */
  }
}

/** Immediate OS banner so enabling desktop alerts is something you can see. */
export function showTestDesktopNotification(): Promise<NotificationDelivery> {
  return showDesktopNotifications([testNotification(Date.now())]);
}
