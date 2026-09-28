/** What a task changed on disk: full diffs for the Changes tab, summaries for the cards. */

import { TaskChangeSummary } from '../../shared/git/changeSummary';
import { DiffFile, DiffStat } from '../../shared/git/diff';
import { TaskWorkspace } from '../../shared/task/workspaces';
import { request } from './http';

export type DiffScope = 'uncommitted' | 'branch';

export interface TaskDiff {
  scope: DiffScope;
  isRepo: boolean;
  cwd: string;
  branch?: string;
  baseRef?: string;
  files: DiffFile[];
  stat: DiffStat;
  truncated: boolean;
  error?: string;
}

/** One folder of a task, with what changed in it. */
export interface WorkspaceDiff extends TaskDiff, TaskWorkspace {}

/** Every folder a task works in, each with its own diff. */
export interface TaskDiffs {
  scope: DiffScope;
  workspaces: WorkspaceDiff[];
}

export const diffApi = {
  /**
   * Working-tree changes, or everything the branch adds over its base — one
   * diff per folder the task works in. `session` says which folder to lead
   * with, not which one to read: a task spread over two repositories is only
   * legible if the tab shows both.
   */
  getDiff: (taskId: string, scope: DiffScope, sessionId?: string) =>
    request<TaskDiffs>(
      `/api/tasks/${taskId}/diff?scope=${scope}${sessionId ? `&session=${encodeURIComponent(sessionId)}` : ''}`
    ),

  /**
   * The change summary behind a set of cards: counts and paths, no patches.
   * Unknown ids come back absent, never as errors.
   */
  getChangeSummaries: (taskIds: string[]) =>
    request<{ summaries: Record<string, TaskChangeSummary> }>(
      `/api/change-summaries?ids=${taskIds.map(encodeURIComponent).join(',')}`
    )
};
