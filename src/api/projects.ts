/** Projects, the folders they point at, and the git checkouts inside them. */

import { WorktreeEntry } from '../../shared/git/worktree';
import { ProjectSuggestion } from '../../shared/setup/onboarding';
import { ProjectFolder } from '../../shared/types';
import { del, post, request } from './http';

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  root?: string;
}

export interface CreatedWorktree {
  path: string;
  name: string;
  branch: string;
  root: string;
}

export type PickFolderResult = { cancelled: true } | { cancelled?: false; path: string; name: string };

export const projectsApi = {
  addProject: (name: string, path: string) => post<ProjectFolder>('/api/projects', { name, path }),

  listProjects: () => request<ProjectFolder[]>('/api/projects'),

  /** Folders OpenCode has worked in that the board does not have yet. */
  projectSuggestions: () => request<ProjectSuggestion[]>('/api/projects/suggestions'),

  /** The per-project column instructions, by project id then column id. */
  saveProjectColumnPrompts: (prompts: Record<string, Record<string, string>>) =>
    post<ProjectFolder[]>('/api/projects/column-prompts', { prompts }),

  deleteProject: (projectId: string) => del<{ success: boolean }>(`/api/projects/${projectId}`),

  pickFolder: (startPath: string) => post<PickFolderResult>('/api/fs/pick-folder', { startPath }),

  gitInfo: (cwd: string) => request<GitInfo>(`/api/fs/git-info?cwd=${encodeURIComponent(cwd)}`),

  listWorktrees: (cwd: string) => request<WorktreeEntry[]>(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`),

  createWorktree: (cwd: string, name: string, taskId?: string) =>
    post<CreatedWorktree>('/api/worktrees', { cwd, name, taskId })
};
