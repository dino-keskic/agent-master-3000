/**
 * Which tasks the board is narrowing to, besides which project they belong to.
 *
 * Two toggles, both off by default: touched today, and actually changed
 * files. They stack with the project chips and with each other — turning one
 * on never clears the other. "Today" is the local calendar day, passed in as
 * `now`, so a test does not depend on the clock.
 */

import { TaskChangeSummary, summarizeChanges } from '../git/changeSummary.js';

export interface TaskViewFilter {
  updatedToday: boolean;
  changedFiles: boolean;
}

export const OPEN_TASK_VIEW: TaskViewFilter = { updatedToday: false, changedFiles: false };

export function toggleTaskView(view: TaskViewFilter, key: keyof TaskViewFilter): TaskViewFilter {
  return { ...view, [key]: !view[key] };
}

/** Local midnight of the calendar day `now` falls on. */
export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** True when `updatedAt` is on the same local day as `now`. */
export function isUpdatedToday(updatedAt: number, now: number): boolean {
  if (!Number.isFinite(updatedAt)) return false;
  const start = startOfLocalDay(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return updatedAt >= start && updatedAt < end.getTime();
}

/**
 * The card's own rule: a summary with no files is not "changed". An unread
 * summary is not changed either — the caller decides whether "unread" means
 * "still loading" or "hide it".
 */
export function hasChangedFiles(summary: TaskChangeSummary | undefined): boolean {
  if (!summary) return false;
  return summarizeChanges(summary).files > 0;
}

/**
 * Apply the two toggles.
 *
 * While the change read is still in flight, a task with no summary yet stays
 * visible: hiding the whole board until `git diff` returns would flash empty
 * columns. A summary that has already arrived is filtered immediately. A
 * failed read filters nothing — there is nothing trustworthy to hide by.
 *
 * Both toggles off returns the same array, so a board that is not narrowed
 * does not re-render its cards.
 */
export function filterTasksForView<T extends { id: string; updatedAt: number }>(
  tasks: T[],
  view: TaskViewFilter,
  summaries: Record<string, TaskChangeSummary>,
  now: number,
  changesReady: boolean,
  changesFailed = false
): T[] {
  if (!view.updatedToday && !view.changedFiles) return tasks;
  const filtered = tasks.filter((task) => {
    if (view.updatedToday && !isUpdatedToday(task.updatedAt, now)) return false;
    if (!view.changedFiles || changesFailed) return true;
    const summary = summaries[task.id];
    if (!summary) return !changesReady;
    return hasChangedFiles(summary);
  });
  return filtered.length === tasks.length ? tasks : filtered;
}

export function countUpdatedToday<T extends { updatedAt: number }>(tasks: T[], now: number): number {
  let count = 0;
  for (const task of tasks) if (isUpdatedToday(task.updatedAt, now)) count += 1;
  return count;
}

export function countChangedFiles<T extends { id: string }>(
  tasks: T[],
  summaries: Record<string, TaskChangeSummary>
): number {
  let count = 0;
  for (const task of tasks) if (hasChangedFiles(summaries[task.id])) count += 1;
  return count;
}
