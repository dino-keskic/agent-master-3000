import { registerNotificationWorker } from './desktop';

/**
 * The browser's permission to notify from this origin: reading it, following
 * it as it changes, and asking for it.
 */

export function desktopPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Call `onChange` whenever the browser's answer may have changed, for
 * `useSyncExternalStore`. The Permissions API reports a change made in the
 * site settings; a grant Chrome withdraws on its own does not always fire it,
 * so coming back to the tab re-reads as well.
 */
export function subscribeDesktopPermission(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => undefined;
  let status: PermissionStatus | undefined;
  let cancelled = false;
  // Missing from some embedded browsers, where the focus re-read is all there is.
  if ('permissions' in navigator) {
    navigator.permissions
      .query({ name: 'notifications' })
      .then((result) => {
        if (cancelled) return;
        status = result;
        status.addEventListener('change', onChange);
      })
      .catch(() => undefined);
  }
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    cancelled = true;
    status?.removeEventListener('change', onChange);
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
  };
}

export async function requestDesktopPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'granted') void registerNotificationWorker();
  return permission;
}
