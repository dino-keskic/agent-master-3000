import { BoardTask } from '../types.js';
import { pickAutoApproveOption, pickRejectOption } from '../agent/permissions.js';
import { taskSessionViews, sessionPendingRequest } from '../task/sessions.js';
import { awaitingDetail } from '../notifications/notifications.js';
import { BoardNotification } from '../notifications/inbox.js';

/**
 * What the board needs from you right now, as one ranked list.
 *
 * The strip above the columns is drawn from this: a permission prompt that can
 * be answered where it sits, a question, a task that failed, and a turn that
 * finished while you were elsewhere. It is the same information the cards and
 * the inbox already hold — gathered, because finding it used to mean scanning
 * every column for an amber border.
 */

export type AttentionKind = 'permission' | 'question' | 'error' | 'review';

export interface AttentionItem {
  /** Stable per session and kind, so a row keeps its place between snapshots. */
  id: string;
  kind: AttentionKind;
  taskId: string;
  sessionId?: string;
  taskTitle: string;
  projectName?: string;
  /** The command, the question, or the error — one line. */
  detail?: string;
  /** When it started needing you; the oldest is the one to answer first. */
  since: number;
  /** Set on a permission: the answers that can be given without opening the task. */
  requestId?: string;
  allowOptionId?: string;
  rejectOptionId?: string;
  /** Set on a review: the inbox row it stands for, so it can be dismissed. */
  notificationId?: string;
}

const KIND_RANK: Record<AttentionKind, number> = { permission: 0, question: 1, error: 2, review: 3 };

function firstLine(text: string | undefined): string | undefined {
  const line = text?.trim().split('\n')[0]?.trim();
  return line || undefined;
}

/**
 * Blocked sessions and failed tasks come from the tasks themselves; finished
 * turns come from the unread inbox, since a task that merely sits idle has
 * nothing to tell you until a turn ends.
 */
export function attentionItems(
  tasks: BoardTask[],
  inbox: Pick<BoardNotification, 'id' | 'event' | 'taskId' | 'sessionId' | 'createdAt' | 'read'>[] = []
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const byId = new Map(tasks.map((task) => [task.id, task]));

  for (const task of tasks) {
    let blocked = false;
    for (const session of taskSessionViews(task)) {
      if (session.runState !== 'awaiting_input') continue;
      const request = sessionPendingRequest(task, session);
      if (!request) continue;
      blocked = true;
      const base = {
        taskId: task.id,
        sessionId: session.sessionId,
        taskTitle: task.title,
        projectName: task.projectName,
        since: request.askedAt,
        requestId: request.requestId
      };
      if (request.type === 'permission') {
        items.push({
          ...base,
          id: `permission:${task.id}:${session.sessionId}`,
          kind: 'permission',
          detail: awaitingDetail(request),
          allowOptionId: pickAutoApproveOption(request.options),
          rejectOptionId: pickRejectOption(request.options)
        });
      } else {
        items.push({
          ...base,
          id: `question:${task.id}:${session.sessionId}`,
          kind: 'question',
          detail: firstLine(request.message)
        });
      }
    }
    // A failure only needs you once nothing else on the task does, and not
    // while a retry is already running.
    if (!blocked && task.runState !== 'running' && (task.runState === 'error' || task.error)) {
      items.push({
        id: `error:${task.id}`,
        kind: 'error',
        taskId: task.id,
        taskTitle: task.title,
        projectName: task.projectName,
        detail: firstLine(task.error) || 'The last turn failed',
        since: task.updatedAt
      });
    }
  }

  const taken = new Set(items.map((item) => item.taskId));
  for (const row of inbox) {
    if (row.read || row.event !== 'turn_complete') continue;
    const task = byId.get(row.taskId);
    // Already listed for something more urgent, or back at work.
    if (!task || taken.has(task.id) || task.runState === 'running') continue;
    taken.add(task.id);
    items.push({
      id: `review:${task.id}`,
      kind: 'review',
      taskId: task.id,
      sessionId: row.sessionId,
      taskTitle: task.title,
      projectName: task.projectName,
      detail: 'Finished its turn',
      since: row.createdAt,
      notificationId: row.id
    });
  }

  return items.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.since - b.since);
}

/** "2 need you" — the count the top bar carries. Empty when nothing does. */
export function attentionLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? '1 needs you' : `${count} need you`;
}
