import { BoardTask, PendingRequest } from '../types.js';
import { listTaskSessions, sessionPendingRequest, sessionRunState } from '../task/sessions.js';
import { awaitingDetail, NotificationRequest, notificationRequestFor } from './notifications.js';
import { NotificationEvent } from './settings.js';
import { sessionInboxKey } from './tags.js';

/**
 * The list you come back to.
 *
 * A desktop notification is the interrupt and is gone the moment it is
 * dismissed; the inbox is what happened while you were away. One row per
 * session, so a session that asked twice is one line, not two.
 */

/**
 * One row of the in-app inbox. Desktop notifications are the interrupt;
 * this is the list you come back to.
 */
export interface BoardNotification {
  id: string;
  event: NotificationEvent;
  taskId: string;
  sessionId?: string;
  taskTitle: string;
  projectName?: string;
  detail?: string;
  createdAt: number;
  read: boolean;
  requestId?: string;
  requestKind?: PendingRequest['type'];
}

/** Inbox rows kept after a burst of finished turns. */
export const MAX_INBOX_NOTIFICATIONS = 50;

/** The session an inbox row is about: the one it names, or the task's own. */
function inboxSession(item: BoardNotification, task: BoardTask) {
  const sessions = listTaskSessions(task);
  return item.sessionId
    ? sessions.find((link) => link.sessionId === item.sessionId)
    : sessions[0];
}

/** Currently blocked sessions, for the inbox after a reload. */
export function seedAwaitingNotifications(tasks: BoardTask[], at = Date.now()): BoardNotification[] {
  const items: BoardNotification[] = [];
  for (const task of tasks) {
    for (const session of listTaskSessions(task)) {
      if (sessionRunState(task, session) !== 'awaiting_input') continue;
      const request = sessionPendingRequest(task, session);
      items.push(
        inboxItemFromRequest(
          notificationRequestFor(task, session.sessionId, 'awaiting_input', awaitingDetail(request), request),
          at
        )
      );
    }
  }
  return items;
}

export function inboxItemFromRequest(request: NotificationRequest, at = Date.now()): BoardNotification {
  return {
    id: sessionInboxKey(request.taskId, request.sessionId),
    event: request.event,
    taskId: request.taskId,
    sessionId: request.sessionId,
    taskTitle: request.taskTitle,
    projectName: request.projectName,
    detail: request.detail,
    createdAt: at,
    read: false,
    requestId: request.requestId,
    requestKind: request.requestKind
  };
}

function isSameAwaiting(existing: BoardNotification, incoming: BoardNotification): boolean {
  return (
    existing.event === 'awaiting_input'
    && incoming.event === 'awaiting_input'
    && existing.requestId === incoming.requestId
  );
}

/**
 * Newest first. One row per session: a later event replaces the previous one
 * for that session. A still-blocked request with the same id updates in place
 * so a refresh does not look like a new ask.
 */
export function mergeInbox(
  inbox: BoardNotification[],
  incoming: BoardNotification[],
  max = MAX_INBOX_NOTIFICATIONS
): BoardNotification[] {
  const bySession = new Map<string, BoardNotification>();
  for (const item of inbox) {
    const key = sessionInboxKey(item.taskId, item.sessionId);
    const existing = bySession.get(key);
    // Old inboxes stacked several rows per session. Keep the newest one.
    if (!existing || item.createdAt >= existing.createdAt) bySession.set(key, item);
  }
  for (const item of incoming) {
    const key = sessionInboxKey(item.taskId, item.sessionId);
    const existing = bySession.get(key);
    if (existing && isSameAwaiting(existing, item)) {
      bySession.set(key, {
        ...existing,
        id: item.id,
        taskTitle: item.taskTitle,
        projectName: item.projectName,
        detail: item.detail,
        requestKind: item.requestKind,
        requestId: item.requestId,
        sessionId: item.sessionId || existing.sessionId
      });
    } else {
      bySession.set(key, item);
    }
  }
  return [...bySession.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, max);
}

export function unreadCount(inbox: BoardNotification[]): number {
  return inbox.reduce((count, item) => count + (item.read ? 0 : 1), 0);
}

export function markNotificationRead(inbox: BoardNotification[], id: string): BoardNotification[] {
  return inbox.map((item) => (item.id === id ? { ...item, read: true } : item));
}

/**
 * Mark what one click answered as read: the rows for that task, narrowed to the
 * session when the click named one. A row with no session of its own is about
 * the task as a whole, so opening any of its sessions has dealt with it.
 */
export function markSessionNotificationsRead(
  inbox: BoardNotification[],
  taskId: string,
  sessionId?: string
): BoardNotification[] {
  return inbox.map((item) =>
    item.taskId === taskId && (!sessionId || !item.sessionId || item.sessionId === sessionId)
      ? { ...item, read: true }
      : item
  );
}

export function markAllNotificationsRead(inbox: BoardNotification[]): BoardNotification[] {
  return inbox.map((item) => (item.read ? item : { ...item, read: true }));
}

export function dismissNotification(inbox: BoardNotification[], id: string): BoardNotification[] {
  return inbox.filter((item) => item.id !== id);
}

/**
 * Drop what the user does not need sitting in the list.
 *
 * A "needs you" whose request has been answered is a to-do that is done, not
 * history. Every other row for a task they currently have open goes too —
 * looking at the task is the notification. The same array comes back when
 * there is nothing to drop, so a render-time correction terminates.
 *
 * An ask whose task is not on the board yet is kept: the first paint has no
 * tasks, and wiping the inbox before hydration would lose work from last time.
 */
export function pruneInbox(
  inbox: BoardNotification[],
  tasks: BoardTask[],
  openTaskIds: readonly string[] = []
): BoardNotification[] {
  let changed = false;
  const next: BoardNotification[] = [];
  for (const item of inbox) {
    if (item.event === 'awaiting_input') {
      const known = tasks.some((candidate) => candidate.id === item.taskId);
      if (known && !isLiveAwaiting(item, tasks)) {
        changed = true;
        continue;
      }
      next.push(item);
      continue;
    }
    if (openTaskIds.includes(item.taskId)) {
      changed = true;
      continue;
    }
    next.push(item);
  }
  return changed ? next : inbox;
}

/** True when this inbox row is still the thing blocking that session. */
export function isLiveAwaiting(item: BoardNotification, tasks: BoardTask[]): boolean {
  if (item.event !== 'awaiting_input') return false;
  const task = tasks.find((candidate) => candidate.id === item.taskId);
  if (!task) return false;
  const session = inboxSession(item, task);
  if (!session) return false;
  if (sessionRunState(task, session) !== 'awaiting_input') return false;
  const request = sessionPendingRequest(task, session);
  if (item.requestId && request && request.requestId !== item.requestId) {
    return false;
  }
  return true;
}

/**
 * The request an inbox row is still blocked on, for a panel that offers Allow
 * and Reject on the row itself. Undefined once the row is history.
 */
export function livePendingRequest(
  item: BoardNotification,
  tasks: BoardTask[]
): PendingRequest | undefined {
  if (!isLiveAwaiting(item, tasks)) return undefined;
  const task = tasks.find((candidate) => candidate.id === item.taskId);
  if (!task) return undefined;
  const session = inboxSession(item, task);
  if (!session) return task.pendingRequest;
  return sessionPendingRequest(task, session) || task.pendingRequest;
}
