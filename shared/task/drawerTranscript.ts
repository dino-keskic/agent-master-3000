import { BoardTask, TaskLogItem } from '../types.js';
import { sessionTranscript } from './logs.js';

/**
 * The transcript the drawer shows for the session on screen, including the
 * two moments OpenCode has nothing to say yet:
 *
 * - a task that has no session: its prompt is what the user wrote, and it
 *   stays visible whether or not the agent ever starts;
 * - a blank session asked for with "New": it is empty from the click, not the
 *   old main session's history until OpenCode gets round to opening it.
 */

/** Id of the stand-in for a task's prompt; never collides with a logged event. */
export function initialPromptLogId(taskId: string): string {
  return `initial-prompt-${taskId}`;
}

/** The task's own prompt as a transcript row, while no session has echoed it. */
export function initialPromptLog(task: BoardTask): TaskLogItem | undefined {
  if (task.sessionId) return undefined;
  const text = (task.prompt || '').trim();
  const images = task.promptImages || [];
  if (!text && images.length === 0) return undefined;
  return {
    id: initialPromptLogId(task.id),
    timestamp: task.createdAt,
    type: 'user_say',
    title: 'User Prompt',
    text,
    ...(images.length > 0 ? { images } : {})
  };
}

/**
 * A "New" click the drawer is waiting on: the main session at the time of the
 * click. `undefined` when there is none.
 */
export interface BlankSessionStart {
  fromSessionId: string | undefined;
}

/** Whether the blank session asked for is still on its way — the task's main session has not moved yet. */
export function blankSessionPending(task: BoardTask, start: BlankSessionStart | undefined): boolean {
  return !!start && task.sessionId === start.fromSessionId;
}

export function drawerTranscript(
  task: BoardTask,
  sessionId: string | undefined,
  fetchedLogs: TaskLogItem[] | undefined,
  blankStart?: BlankSessionStart
): TaskLogItem[] {
  if (blankSessionPending(task, blankStart)) return [];
  const logs = sessionTranscript(task.logs, sessionId, fetchedLogs);
  const initial = initialPromptLog(task);
  if (!initial || logs.some((log) => log.type === 'user_say')) return logs;
  return [initial, ...logs];
}
