import { isAutoTaskTitle, isPlaceholderSessionTitle } from '../format.js';
import { BoardTask, TaskSessionLink } from '../types.js';

/**
 * Which sessions are still waiting for the name OpenCode gives them.
 *
 * OpenCode names a session once, in the background, around the end of its
 * first turn, and over ACP it never says so: the name only shows up in its
 * database. The board's poll re-reads the sessions this picks out, and stops
 * the moment one has its name.
 */

/**
 * How long after its last activity a session is still worth checking. A name
 * lands within seconds of the first turn; one that never came is not coming,
 * and polling the database for it forever would be pure cost.
 */
export const SESSION_TITLE_WATCH_MS = 10 * 60_000;

/**
 * How long the poll stays at its fast cadence for a name. Most names land
 * within seconds; after this, the idle cadence is soon enough.
 */
export const SESSION_TITLE_SOON_MS = 60_000;

/**
 * True while the link still carries a stand-in rather than OpenCode's name,
 * and was active within `within`.
 */
export function awaitsSessionTitle(
  task: Pick<BoardTask, 'sessionId' | 'title' | 'prompt' | 'originalPrompt' | 'titleLocked'>,
  link: Pick<TaskSessionLink, 'sessionId' | 'title' | 'createdAt' | 'updatedAt'>,
  now: number,
  within = SESSION_TITLE_WATCH_MS
): boolean {
  if (now - (link.updatedAt || link.createdAt || 0) > within) return false;
  if (isPlaceholderSessionTitle(link.title) || link.title === 'Session') return true;
  // The main session's link starts out carrying the card's title, which is the
  // prompt until something better arrives.
  return link.sessionId === task.sessionId && link.title === task.title && isAutoTaskTitle(task);
}
