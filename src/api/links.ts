/** The tickets, PRs and pages pinned to a task. */

import { NewTaskLink } from '../../shared/task/links';
import { BoardTask, TaskLink } from '../../shared/types';
import { del, patch, post, request } from './http';

export const linksApi = {
  listTaskLinks: (taskId: string) => request<{ links: TaskLink[] }>(`/api/tasks/${taskId}/links`),

  /** Add or update links. Same URL twice edits the entry rather than duplicating it. */
  addTaskLinks: (taskId: string, links: NewTaskLink[]) =>
    post<{ added: TaskLink[]; updated: TaskLink[]; rejected: string[]; links: TaskLink[]; task: BoardTask }>(
      `/api/tasks/${taskId}/links`,
      { links }
    ),

  updateTaskLink: (taskId: string, linkId: string, patchBody: { title?: string; note?: string }) =>
    patch<BoardTask>(`/api/tasks/${taskId}/links/${encodeURIComponent(linkId)}`, patchBody),

  deleteTaskLink: (taskId: string, linkId: string) =>
    del<BoardTask>(`/api/tasks/${taskId}/links/${encodeURIComponent(linkId)}`)
};
