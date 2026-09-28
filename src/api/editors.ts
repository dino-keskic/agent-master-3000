/** Opening a folder or file in an editor on the user's machine. */

import { post, request } from './http';

export interface EditorOption {
  id: string;
  label: string;
}

export const editorsApi = {
  listEditors: () => request<EditorOption[]>('/api/editors'),

  /**
   * Reveal a folder or file in an external editor on the user's machine.
   * `taskId` says which transcript the link came from, which is what lets a
   * file outside every board folder be opened at all.
   */
  openIn: (editor: string, target: string, line?: number, taskId?: string) =>
    post<{ success: boolean; opened: string }>('/api/open', { editor, target, line, taskId })
};
