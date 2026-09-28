import { BoardTask, TaskLogItem } from '../types.js';
import { isSessionBusy, listTaskSessions, sessionRunState } from '../task/sessions.js';

/**
 * Tool calls that will never report again.
 *
 * A tool call is written `in_progress` when it starts and only leaves that
 * state when a result arrives for its id. When the agent dies mid-call, or the
 * connection drops, or the process restarts, that result never comes — and the
 * row stays live forever, so the board keeps counting a background task that
 * stopped hours ago. An explicit stop already fails these (`failLiveTools`);
 * what is here is the same reckoning for a turn that merely ended.
 *
 * The rule is what the sessions say: a live tool belongs to a session, and once
 * that session is resting there is nothing left to finish it. A tool whose
 * session the task does not list is a subagent's, so it survives as long as
 * anything on the task is still working.
 */

const LIVE: ReadonlySet<string> = new Set(['pending', 'in_progress']);

export const STALE_TOOL_MESSAGE = 'Ended without a result';

/** Sessions the task still considers at work; their in-flight tools are real. */
function busySessionIds(task: BoardTask): Set<string> {
  const busy = new Set<string>();
  for (const link of listTaskSessions(task)) {
    if (isSessionBusy(sessionRunState(task, link))) busy.add(link.sessionId);
  }
  return busy;
}

/** True while any part of the task is still running or waiting on an answer. */
export function taskIsWorking(task: BoardTask): boolean {
  return isSessionBusy(task.runState) || busySessionIds(task).size > 0;
}

/**
 * Which of a task's live tool calls have been orphaned. Exported for the tests
 * and for anything that wants to ask without rewriting the logs.
 */
export function staleToolLogIds(task: BoardTask): string[] {
  const busy = busySessionIds(task);
  const working = isSessionBusy(task.runState) || busy.size > 0;
  const stale: string[] = [];
  for (const log of task.logs) {
    if (!log.toolCall || !LIVE.has(log.toolCall.status)) continue;
    // A session the task lists answers for itself. One it does not list is a
    // subagent's, and only the task as a whole can say whether it is over.
    const known = log.sessionId != null && listedSession(task, log.sessionId);
    const alive = known ? busy.has(log.sessionId as string) : working;
    if (!alive) stale.push(log.id);
  }
  return stale;
}

function listedSession(task: BoardTask, sessionId: string): boolean {
  if (task.sessionId === sessionId) return true;
  return listTaskSessions(task).some((link) => link.sessionId === sessionId);
}

/**
 * The same reckoning, applied. Returns the rewritten logs and only the rows
 * that changed, so the caller can push those instead of the whole transcript.
 */
export function sweepStaleTools(
  task: BoardTask,
  message = STALE_TOOL_MESSAGE
): { logs: TaskLogItem[]; changed: TaskLogItem[] } {
  const stale = new Set(staleToolLogIds(task));
  if (stale.size === 0) return { logs: task.logs, changed: [] };

  const changed: TaskLogItem[] = [];
  const logs = task.logs.map((log) => {
    if (!stale.has(log.id) || !log.toolCall) return log;
    const updated: TaskLogItem = {
      ...log,
      text: log.toolCall.output || message,
      toolCall: { ...log.toolCall, status: 'failed', output: log.toolCall.output || message }
    };
    changed.push(updated);
    return updated;
  });
  return { logs, changed };
}
