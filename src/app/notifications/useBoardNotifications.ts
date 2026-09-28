import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BoardTask, GlobalSettings, NotificationSettings } from '../../../shared/types';
import {
  DesktopAlertState,
  desktopAlertState,
  DesktopPermission,
  NotificationDelivery
} from '../../../shared/notifications/delivery';
import {
  coalesceNotifications,
  detectNotificationEvents,
  notifyableRequests
} from '../../../shared/notifications/notifications';
import { resolveNotificationSettings } from '../../../shared/notifications/settings';
import { notificationTag } from '../../../shared/notifications/tags';
import {
  BoardNotification,
  dismissNotification,
  inboxItemFromRequest,
  markAllNotificationsRead,
  markNotificationRead,
  mergeInbox,
  pruneInbox,
  seedAwaitingNotifications,
  unreadCount
} from '../../../shared/notifications/inbox';
import {
  closeDesktopNotifications,
  closeDesktopNotificationsForTask,
  setNotificationClickHandler,
  showDesktopNotifications,
  showTestDesktopNotification
} from './desktop';
import { loadInbox, saveInbox } from './inboxStorage';
import { isDocumentFocused, setBoardDocumentTitle } from './page';
import { desktopPermission, requestDesktopPermission, subscribeDesktopPermission } from './permission';
import { playNotificationTone } from './tone';

/**
 * What the board has to tell you, and where it says it.
 *
 * The same events reach you in three places — the tab title, a desktop
 * notification, and the inbox you come back to — so they are detected once
 * here and fanned out, rather than each surface deciding for itself. The
 * open task is already on screen: it does not toast, and its inbox rows
 * drop except a still-blocked ask, which stays until it is answered.
 */

export interface BoardNotificationContext {
  tasks: BoardTask[];
  /** Sessions currently blocked, for the tab title. */
  awaitingCount: number;
  settings: NotificationSettings | undefined;
  updateSettings: (patch: Partial<GlobalSettings>) => Promise<void>;
  /** Open a task at a session. False when the board has no such task. */
  onOpenTask: (taskId: string, sessionId?: string) => boolean;
  /** The tasks open in the workspace. Their informational rows are gone. */
  openTaskIds: string[];
}

export interface BoardNotifications {
  inbox: BoardNotification[];
  unread: number;
  /** This browser's answer, read live — the setting alone does not deliver anything. */
  permission: DesktopPermission;
  /** Whether alerts will actually arrive here. */
  alertState: DesktopAlertState;
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** Follow a notification to the session it is about. */
  openSession: (taskId: string, sessionId?: string) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  clear: () => void;
  /** Ask the browser, then prove it works. Reports why if it does not. */
  enableDesktop: () => Promise<NotificationDelivery>;
  /** Raise a sample notification, so "did that work?" has an answer. */
  testDesktop: () => Promise<NotificationDelivery>;
}

export function useBoardNotifications(ctx: BoardNotificationContext): BoardNotifications {
  const { tasks, awaitingCount, settings, updateSettings, onOpenTask, openTaskIds } = ctx;
  const [inbox, setInbox] = useState(loadInbox);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const permission = useSyncExternalStore(subscribeDesktopPermission, desktopPermission, () => 'unsupported' as const);
  const alertState = desktopAlertState(settings, permission);
  const previousTasks = useRef<BoardTask[] | null>(null);
  const previousOpenTaskIds = useRef<string[]>([]);

  // Looking at a task (or answering an ask) has already dealt with those rows.
  // Corrected while rendering rather than in an effect, so no frame is painted
  // with a toast-worthy badge for the open task; the same array comes back
  // when there is nothing to drop, which is what ends this.
  const visibleInbox = pruneInbox(inbox, tasks, openTaskIds);
  if (visibleInbox !== inbox) setInbox(visibleInbox);

  useEffect(() => {
    saveInbox(visibleInbox);
  }, [visibleInbox]);

  useEffect(() => {
    setBoardDocumentTitle(awaitingCount);
  }, [awaitingCount]);

  /**
   * First snapshot of the board is hydration: seed currently-blocked sessions
   * into the inbox, but do not raise desktop notifications for work that
   * already happened. Later snapshots are compared per session.
   */
  useEffect(() => {
    const previous = previousTasks.current;
    previousTasks.current = tasks;

    const events = previous
      ? tasks.flatMap((task) =>
          detectNotificationEvents(previous.find((item) => item.id === task.id), task)
        )
      : [];
    const seeded = seedAwaitingNotifications(tasks);
    if (events.length > 0 || seeded.length > 0) {
      setInbox((current) =>
        pruneInbox(
          mergeInbox(current, [...events.map((event) => inboxItemFromRequest(event)), ...seeded]),
          tasks,
          openTaskIds
        )
      );
    }

    if (!previous || events.length === 0) return;
    const notifyable = notifyableRequests(events, settings, isDocumentFocused(), openTaskIds);
    if (notifyable.length === 0) return;
    void showDesktopNotifications(coalesceNotifications(notifyable));
    if (resolveNotificationSettings(settings).sound) playNotificationTone();
  }, [tasks, settings, openTaskIds]);

  const openSession = useCallback((taskId: string, sessionId?: string) => {
    if (!onOpenTask(taskId, sessionId)) {
      // The board has no such task — the inbox row outlived it, so show the
      // list rather than opening an empty drawer.
      setIsPanelOpen(true);
      return;
    }
    setIsPanelOpen(false);
  }, [onOpenTask]);

  // Opening a task dismisses its OS banners even when the inbox row stays
  // (a still-blocked ask). Dropped rows close their own tags below.
  useEffect(() => {
    for (const taskId of openTaskIds) {
      if (!previousOpenTaskIds.current.includes(taskId)) void closeDesktopNotificationsForTask(taskId);
    }
    previousOpenTaskIds.current = openTaskIds;
  }, [openTaskIds]);

  const previousInboxRef = useRef(visibleInbox);
  useEffect(() => {
    const previous = previousInboxRef.current;
    previousInboxRef.current = visibleInbox;
    if (previous === visibleInbox) return;
    const remaining = new Set(visibleInbox.map((item) => item.id));
    const tags = previous
      .filter((item) => !remaining.has(item.id))
      .map((item) => notificationTag(item.taskId, item.sessionId));
    if (tags.length > 0) void closeDesktopNotifications(tags);
  }, [visibleInbox]);

  // A click on a desktop notification arrives from outside React, at whatever
  // moment the user gets to it, so the handler is read through a ref.
  const latestOpen = useRef(openSession);
  useEffect(() => {
    latestOpen.current = openSession;
  });
  useEffect(() => {
    setNotificationClickHandler((taskId, sessionId) => {
      if (!taskId) setIsPanelOpen(true);
      else latestOpen.current(taskId, sessionId);
    });
  }, []);

  return useMemo(() => ({
    inbox: visibleInbox,
    unread: unreadCount(visibleInbox),
    permission,
    alertState,
    isPanelOpen,
    openPanel: () => setIsPanelOpen(true),
    closePanel: () => setIsPanelOpen(false),
    openSession,
    markRead: (id) => setInbox((current) => markNotificationRead(current, id)),
    markAllRead: () => setInbox((current) => markAllNotificationsRead(current)),
    dismiss: (id) => setInbox((current) => dismissNotification(current, id)),
    clear: () => setInbox([]),
    async enableDesktop(): Promise<NotificationDelivery> {
      const permission = await requestDesktopPermission();
      if (permission === 'unsupported') return { ok: false, reason: 'unsupported' };
      // A refused prompt is the commonest reason the board goes quiet, and it
      // used to return here without a word.
      if (permission !== 'granted') {
        return { ok: false, reason: permission === 'denied' ? 'denied' : 'default' };
      }
      await updateSettings({
        notifications: { ...resolveNotificationSettings(settings), enabled: true }
      });
      return showTestDesktopNotification();
    },
    testDesktop: () => showTestDesktopNotification()
  }), [visibleInbox, permission, alertState, isPanelOpen, openSession, settings, updateSettings]);
}
