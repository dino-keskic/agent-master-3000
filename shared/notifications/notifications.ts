import { BoardTask, NotificationSettings, PendingRequest } from '../types.js';
import { listTaskSessions, sessionPendingRequest, sessionRunState } from '../task/sessions.js';
import { NotificationEvent, shouldNotify } from './settings.js';
import { notificationTag, sessionInboxKey } from './tags.js';

/**
 * Deciding to interrupt: which board changes are worth a notification, and
 * what each one says.
 *
 * The board exists to be left alone while agents work, so it has to be able to
 * interrupt. Everything here is pure. Whether the user wants an event is
 * `settings.ts`, how a banner is tagged is `tags.ts`, and whether the browser
 * let it through is `delivery.ts`. The browser's Notification API lives in
 * `src/app/notifications/`, the only code allowed to touch it, and the list you
 * come back to afterwards is `inbox.ts`.
 */

interface EventCopy {
  /** Completes "TASK-101 …". */
  headline: string;
  /** Completes "3 tasks …". */
  summary: string;
}

const EVENT_COPY: Record<NotificationEvent, EventCopy> = {
  awaiting_input: { headline: 'needs your answer', summary: 'need your answer' },
  turn_complete: { headline: 'finished its turn', summary: 'finished their turns' },
  error: { headline: 'failed', summary: 'failed' }
};

/** What happened, and to which task. */
export interface NotificationRequest {
  event: NotificationEvent;
  taskId: string;
  taskTitle: string;
  /** Named in the body so a cross-project task is not mystery work. */
  projectName?: string;
  /** The error message, on 'error'. */
  detail?: string;
  /** The session a click should open. */
  sessionId?: string;
  /** Set on awaiting_input so a later ask for the same session replaces this one. */
  requestId?: string;
  requestKind?: PendingRequest['type'];
}

/** A notification ready to hand to the browser. */
export interface DesktopNotification {
  /**
   * Notification `tag`. One tag per session, so a newer notification replaces
   * that session's older one instead of stacking a column of them.
   */
  tag: string;
  title: string;
  body: string;
  /** The task a click should open. Absent on a collapsed summary. */
  taskId?: string;
  sessionId?: string;
}

const SUMMARY_TAG = 'agent-master-3000:summary';

export function buildNotification(request: NotificationRequest): DesktopNotification {
  const detail = [request.taskTitle, request.detail].filter((part) => !!part).join(' — ');
  const body = detail || request.taskId;
  return {
    tag: notificationTag(request.taskId, request.sessionId),
    title: `${request.taskId} ${EVENT_COPY[request.event].headline}`,
    body: request.projectName ? `${body} · ${request.projectName}` : body,
    taskId: request.taskId,
    sessionId: request.sessionId
  };
}

/** Past this many tasks a burst says how much happened instead of enumerating it. */
export const MAX_DISTINCT_NOTIFICATIONS = 3;

/**
 * Collapses a burst. Ten sessions finishing at once must not become ten
 * notifications: the newest request wins per session, and a burst spanning more
 * sessions than a person would read becomes a single count.
 */
export function coalesceNotifications(
  requests: NotificationRequest[],
  maxDistinct = MAX_DISTINCT_NOTIFICATIONS
): DesktopNotification[] {
  const newestPerSession = new Map<string, NotificationRequest>();
  for (const request of requests) {
    newestPerSession.set(sessionInboxKey(request.taskId, request.sessionId), request);
  }

  const distinct = [...newestPerSession.values()];
  if (distinct.length === 0) return [];
  if (distinct.length <= maxDistinct) return distinct.map(buildNotification);

  const events = new Set(distinct.map((request) => request.event));
  const single = events.size === 1 ? distinct[0]?.event : undefined;
  return [
    {
      tag: SUMMARY_TAG,
      title: single
        ? `${distinct.length} tasks ${EVENT_COPY[single].summary}`
        : `${distinct.length} board updates`,
      body: distinct.map((request) => request.taskId).join(', ')
    }
  ];
}

/**
 * The ambient signal for a backgrounded tab — "(2) Agent Master 3000". Free next to a
 * notification, and it survives a browser that refuses to raise one.
 */
export function boardDocumentTitle(awaitingCount: number, baseTitle: string): string {
  return awaitingCount > 0 ? `(${awaitingCount}) ${baseTitle}` : baseTitle;
}

export function eventHeadline(event: NotificationEvent): string {
  return EVENT_COPY[event].headline;
}

/** Permission name + path, or the question the agent asked. */
export function awaitingDetail(request: PendingRequest | undefined): string | undefined {
  if (!request) return undefined;
  if (request.type === 'question') return request.message.trim() || undefined;
  const name = request.toolCall.name;
  const location = request.toolCall.locations?.[0]?.split('/').pop();
  const command = commandOf(request.toolCall.rawInput);
  return [name, command || location].filter(Boolean).join(' · ') || name;
}

function commandOf(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ['command', 'cmd']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) {
      return value.length > 80 ? `${value.slice(0, 80)}…` : value;
    }
  }
  return undefined;
}

/**
 * Per-session transitions worth telling the user about. A first sighting of a
 * task (no previous snapshot) is hydration, not an event — the inbox seeds
 * currently-blocked sessions separately so a refresh does not look like a
 * burst of finished turns.
 */
export function detectNotificationEvents(
  previous: BoardTask | undefined,
  next: BoardTask
): NotificationRequest[] {
  if (!previous) return [];

  const prevById = new Map(
    listTaskSessions(previous).map((session) => [session.sessionId, session])
  );
  const events: NotificationRequest[] = [];

  for (const session of listTaskSessions(next)) {
    const prior = prevById.get(session.sessionId);
    const prevState = prior ? sessionRunState(previous, prior) : undefined;
    const nextState = sessionRunState(next, session);
    const request = sessionPendingRequest(next, session);
    const prevRequest = prior ? sessionPendingRequest(previous, prior) : undefined;

    // A new (or replaced) permission/question is always a needs-you event,
    // even if the session was already blocked on a previous one.
    if (request && request.requestId !== prevRequest?.requestId) {
      events.push(notificationRequestFor(next, session.sessionId, 'awaiting_input', awaitingDetail(request), request));
    } else if (nextState === 'awaiting_input' && prevState !== 'awaiting_input') {
      events.push(notificationRequestFor(next, session.sessionId, 'awaiting_input', awaitingDetail(request), request));
    } else if (nextState === 'error' && prevState !== 'error') {
      events.push(notificationRequestFor(next, session.sessionId, 'error', session.error || next.error));
    } else if (nextState === 'idle' && prevState === 'running') {
      events.push(notificationRequestFor(next, session.sessionId, 'turn_complete', session.lastMessage || next.lastMessage));
    }
  }

  return events;
}

/** One `NotificationRequest` for one session of one task. */
export function notificationRequestFor(
  task: BoardTask,
  sessionId: string,
  event: NotificationEvent,
  detail?: string,
  request?: PendingRequest
): NotificationRequest {
  return {
    event,
    taskId: task.id,
    taskTitle: task.title,
    projectName: task.projectName,
    sessionId,
    detail,
    requestId: request?.requestId,
    requestKind: request?.type
  };
}

/**
 * Desktop-notify only the events the user asked to hear about, in this burst.
 *
 * A task open in the workspace is already on screen, so it does not raise an
 * interrupt — but only while the board is actually in front of you. Panels
 * persist in the `?task=` link now, so the task you are running is open all
 * day; suppressing it whatever the window is doing meant the one task you
 * wanted to hear about was the one that never said anything.
 */
export function notifyableRequests(
  requests: NotificationRequest[],
  settings: Partial<NotificationSettings> | undefined,
  documentFocused: boolean,
  openTaskIds: readonly string[] = []
): NotificationRequest[] {
  return requests.filter((request) => {
    if (documentFocused && openTaskIds.includes(request.taskId)) return false;
    return shouldNotify(request.event, settings, documentFocused);
  });
}
