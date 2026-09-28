/** One task's life on the board: create, edit, move, run, archive, answer. */

import { MoveResult } from '../../shared/board/projectMove';
import { BoardTask, PermissionAnswer, PromptImage } from '../../shared/types';
import { del, patch, post, request } from './http';

/**
 * Where a piece of work should end up. Both halves are optional: name a project
 * to move it there, a folder to pick the checkout, or neither to detach it.
 */
export interface MoveTargetInput {
  projectId?: string | null;
  cwd?: string | null;
}

/**
 * A move answers with the task *and* the line it wrote to the log, because the
 * published task carries no logs and only the server knows what actually
 * changed — which project, which checkout, and when it takes effect.
 */
export type MovedTask = BoardTask & { move?: MoveResult };

export const tasksApi = {
  /**
   * The full task, transcript included. The board list and the WebSocket both
   * omit logs, so this is what the drawer calls to show a whole conversation.
   */
  getTask: (taskId: string) => request<BoardTask>(`/api/tasks/${taskId}`),

  createTask: (task: Partial<BoardTask>) => post<BoardTask>('/api/tasks', task),

  updateTask: (taskId: string, updates: Partial<BoardTask>) =>
    patch<BoardTask>(`/api/tasks/${taskId}`, updates),

  renameTask: (taskId: string, title: string) => patch<BoardTask>(`/api/tasks/${taskId}/title`, { title }),

  moveTask: (taskId: string, columnId: string) => post<BoardTask>(`/api/tasks/${taskId}/move`, { columnId }),

  /**
   * Send the task somewhere else: another project, another checkout of one, or
   * both. An empty target takes it out of its project without moving it. This
   * decides the folder the next turn runs in, and takes its sessions with it.
   */
  moveTaskToProject: (taskId: string, target: MoveTargetInput) =>
    post<MovedTask>(`/api/tasks/${taskId}/project`, target),

  runTask: (taskId: string) => post<BoardTask>(`/api/tasks/${taskId}/run`),

  promptTask: (taskId: string, prompt: string, images?: PromptImage[]) =>
    post<BoardTask>(`/api/tasks/${taskId}/prompt`, { prompt, images }),

  stopTask: (taskId: string) => post<BoardTask>(`/api/tasks/${taskId}/stop`),

  /** Take back a queued prompt before the running turn gets to it. */
  removeQueuedTurn: (taskId: string, queuedId: string) =>
    del<BoardTask>(`/api/tasks/${taskId}/queued/${encodeURIComponent(queuedId)}`),

  /** Summarize the session so far so it can continue with a smaller context. */
  compactTask: (taskId: string) => post<BoardTask>(`/api/tasks/${taskId}/compact`),

  /** Answer a permission request or question the agent is blocked on. */
  respond: (taskId: string, answer: PermissionAnswer) =>
    post<BoardTask>(`/api/tasks/${taskId}/respond`, answer),

  /** Take a task off the board. Reversible: nothing it holds is dropped. */
  archiveTask: (taskId: string) => post<BoardTask>(`/api/tasks/${taskId}/archive`),

  /** Put an archived task back on the board. */
  restoreTask: (taskId: string) => post<BoardTask>(`/api/tasks/${taskId}/restore`),

  /** The recovery list, newest archive first, without transcripts. */
  archivedTasks: () => request<{ tasks: BoardTask[] }>('/api/tasks/archived'),

  /** Gone for good. The server refuses this for a task that is still on the board. */
  deleteArchivedTask: (taskId: string) => del<{ success: boolean }>(`/api/tasks/${taskId}`),

  /** Archives every task in the column; returns the ids that left the board. */
  clearColumn: (columnId: string) => del<{ success: boolean; archived: string[] }>(`/api/columns/${columnId}/tasks`)
};
