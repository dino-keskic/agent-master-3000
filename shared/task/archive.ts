import { BoardColumn, BoardTask } from '../types.js';

/**
 * What "archived" means for a task.
 *
 * A card leaves the board by being marked `archivedAt` rather than spliced out
 * of state, so its logs, sessions, comments and links survive and a restore is
 * a single field away. Everything that decides which side of that line a task
 * falls on lives here: the predicates the board and the store filter with, the
 * order the recovery list reads in, and where a restored task lands.
 *
 * Absent `archivedAt` means live. Boards written before archiving existed have
 * no such field on any task, so they load as an entirely live board with no
 * migration step — which is the whole reason the marker is an optional stamp
 * rather than a required status.
 */

/** The archive stamp, or nothing when the task is live. */
export function archivedAt(task: Pick<BoardTask, 'archivedAt'>): number | undefined {
  return typeof task.archivedAt === 'number' && Number.isFinite(task.archivedAt)
    ? task.archivedAt
    : undefined;
}

export function isArchived(task: Pick<BoardTask, 'archivedAt'>): boolean {
  return archivedAt(task) !== undefined;
}

export function isLive(task: Pick<BoardTask, 'archivedAt'>): boolean {
  return !isArchived(task);
}

/** The board: everything the kanban draws and every count is taken from. */
export function liveTasks<T extends Pick<BoardTask, 'archivedAt'>>(tasks: T[]): T[] {
  return tasks.filter(isLive);
}

/**
 * The recovery list: newest archive first, because the one you want back is
 * almost always the one you just archived. Ties fall back to `updatedAt` and
 * then to the id, so a batch archived in the same millisecond — a cleared
 * column — still has one stable order rather than the file's.
 */
export function archivedTasks<T extends Pick<BoardTask, 'id' | 'archivedAt' | 'updatedAt'>>(
  tasks: T[]
): T[] {
  return tasks
    .filter(isArchived)
    .slice()
    .sort((a, b) =>
      (archivedAt(b) as number) - (archivedAt(a) as number)
      || (b.updatedAt || 0) - (a.updatedAt || 0)
      || a.id.localeCompare(b.id)
    );
}

/** Both halves in one pass, for callers that need each. */
export function splitByArchive<T extends Pick<BoardTask, 'id' | 'archivedAt' | 'updatedAt'>>(
  tasks: T[]
): { live: T[]; archived: T[] } {
  return { live: liveTasks(tasks), archived: archivedTasks(tasks) };
}

/**
 * Where a restored task comes back to.
 *
 * It returns to the column it was archived from when that column still exists.
 * Columns are editable while a task sits in the archive, so the one it left may
 * be gone by then; it then lands in the first column — the board's inbox, and
 * the same fallback `rehomeOrphanedTasks` applies to a live orphan, so a
 * restore can never leave a card the board cannot draw. With no columns at all
 * (only reachable from a hand-written board file) the seeded `backlog` id is
 * the last resort.
 */
export function restoreColumnId(
  task: Pick<BoardTask, 'columnId'>,
  columns: Pick<BoardColumn, 'id'>[]
): string {
  if (columns.some((column) => column.id === task.columnId)) return task.columnId;
  return columns[0]?.id || 'backlog';
}

/** True when restoring this task has to move it, so the caller can say so. */
export function restoreRehomes(
  task: Pick<BoardTask, 'columnId'>,
  columns: Pick<BoardColumn, 'id'>[]
): boolean {
  return restoreColumnId(task, columns) !== task.columnId;
}
