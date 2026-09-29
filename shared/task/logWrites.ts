import { BoardTask, TaskLogItem } from '../types.js';
import { clipText } from '../sessions/list.js';
import { MAX_TASK_LOGS, combineLogItems, findMatchingLogIndex } from './logs.js';

/**
 * Writing to a task's transcript.
 *
 * `logs.ts` decides how two versions of a log line combine; this decides
 * what that does to the task holding them — the previews on the card, the
 * previews on the session it came from, and the cap on how much is kept.
 */

export const MAX_LOG_TEXT = 8_000;

/** One log line, with anything unreasonably long cut down before it is stored. */
export function clipLogItem(log: TaskLogItem): TaskLogItem {
  const text = log.text && log.text.length > MAX_LOG_TEXT
    ? `${log.text.slice(0, MAX_LOG_TEXT)}\n…`
    : log.text;
  const output = log.toolCall?.output && log.toolCall.output.length > MAX_LOG_TEXT
    ? `${log.toolCall.output.slice(0, MAX_LOG_TEXT)}\n…`
    : log.toolCall?.output;
  if (text === log.text && output === log.toolCall?.output) return log;
  return {
    ...log,
    text,
    toolCall: log.toolCall ? { ...log.toolCall, output } : log.toolCall
  };
}

/** Caps and clips a task's transcript in place. True when anything moved. */
export function trimTaskLogs(task: BoardTask): boolean {
  let changed = false;
  if (task.logs.length > MAX_TASK_LOGS) {
    task.logs = task.logs.slice(-MAX_TASK_LOGS);
    changed = true;
  }
  for (let i = 0; i < task.logs.length; i++) {
    const log = task.logs[i];
    if (!log) continue;
    const clipped = clipLogItem(log);
    if (clipped !== log) {
      task.logs[i] = clipped;
      changed = true;
    }
  }
  return changed;
}

/**
 * The card's and the session's "last thing said" previews. `at` is when the
 * session last did something: now for a live line, the line's own time for a
 * replayed one.
 */
function updatePreviews(task: BoardTask, log: TaskLogItem, at: number): void {
  if (log.type === 'agent_say' && log.text) {
    task.lastMessage = clipText(log.text);
  }
  if (log.type === 'user_say' && log.text) {
    task.lastUserMessage = clipText(log.text);
  }
  if (!log.sessionId || !task.sessions) return;
  const link = task.sessions.find((s) => s.sessionId === log.sessionId);
  if (!link) return;
  link.updatedAt = Math.max(link.updatedAt || 0, at);
  if (log.type === 'agent_say' && log.text) {
    link.lastMessage = clipText(log.text);
  }
  if (log.type === 'user_say' && log.text) {
    link.lastUserMessage = clipText(log.text);
  }
}

/**
 * Add one log line, or update the one already stored under its id — that is
 * what makes a streaming message replace itself instead of piling up.
 */
export function applyLogToTask(task: BoardTask, logItem: TaskLogItem): void {
  const existingIndex = task.logs.findIndex((l) => l.id === logItem.id);
  if (existingIndex >= 0) {
    task.logs[existingIndex] = clipLogItem({
      ...task.logs[existingIndex],
      ...logItem,
      timestamp: logItem.timestamp || Date.now()
    });
  } else {
    task.logs.push(clipLogItem(logItem));
  }

  if (task.logs.length > MAX_TASK_LOGS) {
    task.logs.splice(0, task.logs.length - MAX_TASK_LOGS);
  }

  updatePreviews(task, logItem, Date.now());
  task.updatedAt = Date.now();
}

/**
 * Fold replayed history into the transcript. Same id-merge as
 * `applyLogToTask`, but for a batch, and the rows that actually changed come
 * back so the caller can push those instead of the whole log.
 */
export function mergeLogsIntoTask(task: BoardTask, incoming: TaskLogItem[]): TaskLogItem[] {
  const changed: TaskLogItem[] = [];
  const used = new Set<number>();
  for (const logItem of incoming) {
    const clipped = clipLogItem(logItem);
    const existingIndex = findMatchingLogIndex(task.logs, clipped, used);
    const previous = existingIndex >= 0 ? task.logs[existingIndex] : undefined;
    if (previous && existingIndex >= 0) {
      used.add(existingIndex);
      const next = clipLogItem(combineLogItems(previous, clipped));
      const same =
        previous.id === next.id
        && previous.text === next.text
        && previous.toolCall?.status === next.toolCall?.status
        && previous.toolCall?.output === next.toolCall?.output
        && previous.metadata?.model === next.metadata?.model;
      if (same) continue;
      task.logs[existingIndex] = next;
      changed.push(next);
    } else {
      task.logs.push(clipped);
      used.add(task.logs.length - 1);
      changed.push(clipped);
    }
    updatePreviews(task, clipped, clipped.timestamp || 0);
  }

  if (changed.length > 0) {
    task.logs.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    if (task.logs.length > MAX_TASK_LOGS) {
      task.logs.splice(0, task.logs.length - MAX_TASK_LOGS);
    }
    // Dated by the activity, not by the read. Opening a task replays its whole
    // history, and rows the log cap trimmed come back as "changed" every time;
    // stamping now would put every task anyone looks at under "Updated today".
    const newest = Math.max(...changed.map((log) => log.timestamp || 0));
    if (newest > (task.updatedAt || 0)) task.updatedAt = newest;
  }
  return changed;
}
