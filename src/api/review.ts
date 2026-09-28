/** Review comments left on a task's diff, and the threads under them. */

import { BoardTask, ChangelogAuthor, ChangelogComment } from '../../shared/types';
import { del, post, request } from './http';

const commentPath = (taskId: string, commentId: string) =>
  `/api/tasks/${taskId}/comments/${encodeURIComponent(commentId)}`;

export const reviewApi = {
  listChangelogComments: (taskId: string) =>
    request<{ comments: ChangelogComment[] }>(`/api/tasks/${taskId}/comments`),

  addChangelogComment: (
    taskId: string,
    input: {
      path: string;
      /** The folder the file is in, when the task works in more than one. */
      cwd?: string;
      newLine?: number;
      oldLine?: number;
      side: ChangelogComment['side'];
      snippet?: string;
      body: string;
    }
  ) => post<BoardTask>(`/api/tasks/${taskId}/comments`, input),

  replyToChangelogComment: (taskId: string, commentId: string, body: string, author: ChangelogAuthor = 'user') =>
    post<BoardTask>(`${commentPath(taskId, commentId)}/replies`, { body, author }),

  resolveChangelogComment: (taskId: string, commentId: string, resolved = true) =>
    post<BoardTask>(`${commentPath(taskId, commentId)}/resolve`, { resolved }),

  deleteChangelogComment: (taskId: string, commentId: string) =>
    del<BoardTask>(commentPath(taskId, commentId))
};
