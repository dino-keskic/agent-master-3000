/**
 * Which tasks the split workspace has open, side by side, and which one of
 * them has the user's attention.
 *
 * Every way of changing that — a card click, "open beside", a notification,
 * closing a panel, a task disappearing from the board — is a pure step here,
 * so the rules (the cap, no task twice, where focus goes when a panel closes)
 * are tested once rather than re-derived in each hook and button.
 *
 * A task is never open in two panels: the session a panel shows is stored on
 * the server per task (`activeSessionId`), so two panels on one task would keep
 * switching each other's conversation.
 */

import { BoardTask, TaskRunState } from '../types.js';

/** Three panels is where a transcript and its composer stop being readable. */
export const MAX_PANES = 3;

export interface SplitLayout {
  /** Open tasks, left to right. */
  taskIds: string[];
  /** The panel with the user's attention; one of `taskIds`, or null when empty. */
  focusedId: string | null;
}

export const EMPTY_LAYOUT: SplitLayout = { taskIds: [], focusedId: null };

/** A layout showing just these tasks, focused on the last — how a deep link lands. */
export function layoutOf(taskIds: string[]): SplitLayout {
  const ids = [...new Set(taskIds)].slice(0, MAX_PANES);
  return { taskIds: ids, focusedId: ids[ids.length - 1] ?? null };
}

/**
 * Show a task the plain way: focus it if it is already open, open it alone if
 * nothing is, and otherwise put it in place of the focused panel.
 */
export function openTask(layout: SplitLayout, taskId: string): SplitLayout {
  if (layout.taskIds.includes(taskId)) return focusTask(layout, taskId);
  const anchor = layout.focusedId ?? layout.taskIds[layout.taskIds.length - 1];
  if (!anchor) return { taskIds: [taskId], focusedId: taskId };
  return replacePane(layout, anchor, taskId);
}

/**
 * Open a task in a panel of its own, to the right of `anchorId` (the focused
 * panel when not given). At the cap there is no room left, so it replaces the
 * anchor instead — the user asked for this task on screen, and losing the one
 * they were pointing at is the least surprising thing to give up.
 */
export function openBeside(layout: SplitLayout, taskId: string, anchorId?: string): SplitLayout {
  if (layout.taskIds.includes(taskId)) return focusTask(layout, taskId);
  const anchor = anchorId && layout.taskIds.includes(anchorId)
    ? anchorId
    : layout.focusedId ?? layout.taskIds[layout.taskIds.length - 1];
  if (!anchor) return { taskIds: [taskId], focusedId: taskId };
  if (layout.taskIds.length >= MAX_PANES) return replacePane(layout, anchor, taskId);
  const taskIds = [...layout.taskIds];
  taskIds.splice(taskIds.indexOf(anchor) + 1, 0, taskId);
  return { taskIds, focusedId: taskId };
}

/** Give a panel the focus. The same layout comes back when it already has it. */
export function focusTask(layout: SplitLayout, taskId: string): SplitLayout {
  if (layout.focusedId === taskId || !layout.taskIds.includes(taskId)) return layout;
  return { ...layout, focusedId: taskId };
}

/**
 * Close one panel. Focus moves to the panel that slides into its place, or the
 * one before it when it was the last — where the eye already is.
 */
export function closeTask(layout: SplitLayout, taskId: string): SplitLayout {
  const index = layout.taskIds.indexOf(taskId);
  if (index < 0) return layout;
  const taskIds = layout.taskIds.filter((id) => id !== taskId);
  const focusedId = layout.focusedId === taskId
    ? taskIds[Math.min(index, taskIds.length - 1)] ?? null
    : layout.focusedId;
  return { taskIds, focusedId };
}

/**
 * Drop panels whose task is no longer on the board (archived, deleted).
 *
 * Returns the *same* layout when nothing is dropped, so a caller can run it
 * while rendering and set state only on a real change without looping.
 */
export function pruneLayout(layout: SplitLayout, isKnown: (taskId: string) => boolean): SplitLayout {
  if (layout.taskIds.every(isKnown)) return layout;
  return layout.taskIds.filter((id) => !isKnown(id)).reduce(closeTask, layout);
}

function replacePane(layout: SplitLayout, anchorId: string, taskId: string): SplitLayout {
  return {
    taskIds: layout.taskIds.map((id) => (id === anchorId ? taskId : id)),
    focusedId: taskId
  };
}

/** How urgently a task wants a panel: an ask first, then work in flight. */
const RUN_STATE_RANK: Record<TaskRunState, number> = { awaiting_input: 0, running: 1, error: 2, idle: 3 };

/**
 * The tasks "open beside" offers: not already open, matching what was typed
 * against the id or the title, the ones that need attention first and board
 * order after that.
 */
export function splitCandidates(
  tasks: readonly BoardTask[],
  openTaskIds: readonly string[],
  query: string,
  limit = 50
): BoardTask[] {
  const needle = query.trim().toLowerCase();
  return tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => !openTaskIds.includes(task.id))
    .filter(({ task }) => !needle
      || task.id.toLowerCase().includes(needle)
      || task.title.toLowerCase().includes(needle))
    .sort((a, b) => RUN_STATE_RANK[a.task.runState] - RUN_STATE_RANK[b.task.runState] || a.index - b.index)
    .slice(0, limit)
    .map(({ task }) => task);
}
