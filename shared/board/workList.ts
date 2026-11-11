import { BoardColumn, BoardTask } from '../types.js';

/**
 * The board, as the list beside an open task.
 *
 * With a task open the columns are gone, and what matters is no longer which
 * stage a task is in but whether it wants something: the list is grouped by
 * that, so hopping to the next thing that needs you is one click.
 */

export type WorkGroupId = 'needs' | 'running' | 'idle';

export interface WorkGroup {
  id: WorkGroupId;
  title: string;
  tasks: BoardTask[];
}

const TITLES: Record<WorkGroupId, string> = { needs: 'Needs you', running: 'Running', idle: 'Idle' };

export function workGroupOf(task: Pick<BoardTask, 'runState' | 'error'>): WorkGroupId {
  if (task.runState === 'awaiting_input') return 'needs';
  if (task.runState === 'running') return 'running';
  if (task.runState === 'error' || task.error) return 'needs';
  return 'idle';
}

/** Groups in the order a person triages, each newest first. Empty groups are left out. */
export function workGroups(tasks: BoardTask[]): WorkGroup[] {
  const buckets: Record<WorkGroupId, BoardTask[]> = { needs: [], running: [], idle: [] };
  for (const task of tasks) buckets[workGroupOf(task)].push(task);
  return (['needs', 'running', 'idle'] as const)
    .map((id) => ({
      id,
      title: TITLES[id],
      tasks: buckets[id].sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .filter((group) => group.tasks.length > 0);
}

/** Task ids in reading order: down each column, columns left to right. */
export function boardOrder(tasks: Pick<BoardTask, 'id' | 'columnId'>[], columns: Pick<BoardColumn, 'id'>[]): string[] {
  return columns.flatMap((column) => tasks.filter((task) => task.columnId === column.id).map((task) => task.id));
}

/**
 * The task `delta` steps from `currentId`, stopping at either end. With nothing
 * selected, stepping forward lands on the first and stepping back on the last.
 */
export function stepTask(order: string[], currentId: string | undefined, delta: number): string | undefined {
  if (order.length === 0) return undefined;
  const at = currentId ? order.indexOf(currentId) : -1;
  if (at === -1) return delta >= 0 ? order[0] : order[order.length - 1];
  return order[Math.max(0, Math.min(order.length - 1, at + delta))];
}
