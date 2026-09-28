import { newId } from '../../shared/ids.js';
import { handoffLog, sessionNeedsHandoff } from '../../shared/sessions/handoff.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { BoardTask } from '../../shared/types.js';
import { cloneOpenCodeSession } from '../opencode/clone.js';
import { getOpenCodeSession } from '../opencode/sessionList.js';
import { taskStore } from '../board/taskStore.js';

/**
 * Before a turn: when the board has moved its session to a folder OpenCode does
 * not have it filed under, copy the conversation into a new session filed there
 * and let that one take over. Returns the session the turn should run in
 * instead, or undefined when the session is already where it belongs.
 *
 * See shared/sessions/handoff.ts for why a move cannot simply be told to OpenCode.
 */
export function handOffMovedSession(task: BoardTask, sessionId: string | undefined): string | undefined {
  if (!sessionId) return undefined;
  // A session the board has no link for yet (a fork on its first turn) has no
  // folder of its own to be moved to.
  const link = listTaskSessions(task).find((entry) => entry.sessionId === sessionId);
  if (!link) return undefined;

  const folder = sessionCwd(task, link);
  const filed = getOpenCodeSession(sessionId)?.cwd;
  if (!filed || !sessionNeedsHandoff(folder, filed)) return undefined;

  const title = link.title || task.title;
  const cloned = cloneOpenCodeSession(sessionId, title, { directory: folder });
  if (!cloned) throw new Error(`Could not carry session "${title}" over to ${folder}`);

  const primary = sessionId === task.sessionId;
  taskStore.linkSession(task.id, {
    sessionId: cloned.sessionId,
    title,
    kind: link.kind === 'btw' ? 'btw' : 'main',
    origin: 'fork',
    forkedFrom: sessionId,
    // The copy starts with the old session's spend on its row; only what it
    // spends from here on is its own.
    costAtFork: cloned.costAtFork,
    // The copy is the same conversation in another folder; re-modelling it on
    // the way across is not something the user asked for.
    chosen: link.chosen,
    cwd: link.cwd,
    projectId: link.projectId,
    projectName: link.projectName,
    primary,
    supersedes: sessionId
  });
  taskStore.addLogToTask(task.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'status_change',
    title: 'Project',
    text: handoffLog(title, filed, folder),
    sessionId: cloned.sessionId
  });
  return cloned.sessionId;
}
