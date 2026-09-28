import { useEffect, useState } from 'react';
import { api, GitInfo } from '../../api';
import { WorktreeEntry } from '../../../shared/git/worktree';

/**
 * Where the next task will run.
 *
 * A project folder is not necessarily one checkout: the board offers every
 * worktree of the repo, and can cut a fresh one so a task starts on its own
 * branch. Reading that list means shelling out to git, so it is read once per
 * project rather than per render.
 */

export interface WorktreeTarget {
  git: GitInfo | null;
  /** Worktrees that can actually be worked in — no bare repos, no stale ones. */
  checkouts: WorktreeEntry[];
  /** The chosen checkout, or the project folder when there is no repo. */
  target: string;
  setTarget: (path: string) => void;
  /** Cut a new worktree for the next task instead of using the chosen one. */
  createNew: boolean;
  setCreateNew: (on: boolean) => void;
  /**
   * The cwd a new task should run in, cutting the worktree first when that is
   * what was asked for. Named after the task's ticket when it has one, and
   * otherwise from its own text, so the branch says what the work is.
   *
   * @param taskId the task the worktree is for, when it is already on the
   *   board — it is what the server reads the ticket off.
   */
  resolveCwd: (text: string, taskId?: string) => Promise<{ cwd: string; worktreeName?: string }>;
}

/**
 * @param preferredPath a checkout to start on when the project has it — the
 *   folder work already runs in, so moving it somewhere else starts from where
 *   it is rather than from the repo root.
 */
export function useWorktreeTarget(
  projectPath: string | undefined,
  fallbackCwd: string,
  preferredPath?: string
): WorktreeTarget {
  const [git, setGit] = useState<GitInfo | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [target, setTarget] = useState('');
  const [createNew, setCreateNew] = useState(false);

  useEffect(() => {
    setTarget(projectPath || '');
    setCreateNew(false);
    if (!projectPath) {
      setGit(null);
      setWorktrees([]);
      return;
    }
    let cancelled = false;
    Promise.all([api.gitInfo(projectPath), api.listWorktrees(projectPath)])
      .then(([info, list]) => {
        if (cancelled) return;
        setGit(info);
        setWorktrees(list);
        // The project folder may sit inside the checkout, so snap the selection
        // onto the listed entry for its repo root — otherwise nothing matches.
        const base = list.find(w => w.path === preferredPath) || list.find(w => w.path === info.root);
        if (base) setTarget(base.path);
      })
      .catch(() => {
        if (cancelled) return;
        setGit({ isRepo: false });
        setWorktrees([]);
      });
    return () => { cancelled = true; };
  }, [projectPath, preferredPath]);

  return {
    git,
    checkouts: worktrees.filter(w => !w.bare && !w.prunable),
    target,
    setTarget,
    createNew,
    setCreateNew,

    async resolveCwd(text, taskId) {
      const projectCwd = projectPath || fallbackCwd;
      if (!createNew || !git?.isRepo) return { cwd: target || projectCwd };

      const created = await api.createWorktree(projectCwd, text, taskId);
      setCreateNew(false);
      setTarget(created.path);
      // Offer the fresh checkout in the picker without waiting on a project switch.
      api.listWorktrees(projectCwd).then(setWorktrees).catch(() => { /* keep the list we have */ });
      return { cwd: created.path, worktreeName: created.name };
    }
  };
}
