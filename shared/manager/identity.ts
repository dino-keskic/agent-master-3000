/**
 * Which task is the manager.
 *
 * The manager is an ordinary task — its own sessions, transcript and composer,
 * so the drawer shows it like any other — that lives off the kanban and talks
 * about the rest of the board. It is told apart by a fixed id rather than a
 * flag, because the id is the one thing every layer already has: the MCP
 * process OpenCode spawns knows only its task id, and that is enough for it to
 * offer the board-wide tools.
 */

import { BoardTask } from '../types.js';

export const MANAGER_TASK_ID = 'MANAGER';

export const MANAGER_TITLE = 'Manager';

export function isManagerTask(task: Pick<BoardTask, 'id'> | string): boolean {
  return (typeof task === 'string' ? task : task.id) === MANAGER_TASK_ID;
}

export function findManager<T extends Pick<BoardTask, 'id'>>(tasks: T[]): T | undefined {
  return tasks.find(isManagerTask);
}

/**
 * The tasks that belong on the kanban. The same array comes back when the
 * manager is not among them, so a board without one memoises as before.
 */
export function withoutManager<T extends Pick<BoardTask, 'id'>>(tasks: T[]): T[] {
  return tasks.some(isManagerTask) ? tasks.filter((task) => !isManagerTask(task)) : tasks;
}
