import { useCallback, useEffect, useRef, useState } from 'react';
import { ChangelogComment } from '../../../shared/types';
import { api, DiffScope, WorkspaceDiff } from '../../api';
import { reportError } from '../../app/notify';

/**
 * The diff on screen: which folders, which changes, how fresh, and which files
 * are open.
 *
 * A task works in one folder per session, and its sessions can sit in different
 * projects, so what is loaded here is a list of folders — each with its own
 * diff. Files are collapsed by folder *and* path, because two repositories can
 * both have a `src/index.ts` and folding one must not fold the other.
 *
 * A turn writes files as it runs, so this reloads itself while one is in
 * flight. Those reloads are deliberately quiet — swapping in a spinner
 * mid-read is what made the tab unusable — and the spinner is kept for the
 * switches the user makes.
 */

const SCOPE_KEY = 'agentMasterDiffScope';

/** How often the diff re-reads the working tree while a turn is in flight. */
const LIVE_REFRESH_MS = 15_000;

/** Files past this many start collapsed, so the tab opens on a list. */
const COLLAPSE_ABOVE = 4;

function readDiffScope(): DiffScope {
  try {
    return window.localStorage.getItem(SCOPE_KEY) === 'branch' ? 'branch' : 'uncommitted';
  } catch {
    return 'uncommitted';
  }
}

function writeDiffScope(scope: DiffScope): void {
  try {
    window.localStorage.setItem(SCOPE_KEY, scope);
  } catch {
    /* a board that cannot remember the scope still works */
  }
}

/** A file is identified by its folder and its path, never by path alone. */
function fileKey(cwd: string, path: string): string {
  return `${cwd}\0${path}`;
}

export interface TaskDiffView {
  scope: DiffScope;
  pickScope: (scope: DiffScope) => void;
  /** Null until the first read lands; one entry per folder after that. */
  workspaces: WorkspaceDiff[] | null;
  loading: boolean;
  reload: () => void;
  isCollapsed: (cwd: string, path: string) => boolean;
  toggle: (cwd: string, path: string) => void;
  /** Open a file. A note that predates multi-folder tasks names no folder,
   *  so an absent `cwd` opens that path wherever it appears. */
  expand: (path: string, cwd?: string) => void;
}

export function useTaskDiff(
  taskId: string,
  sessionId: string | undefined,
  running: boolean,
  comments: ChangelogComment[]
): TaskDiffView {
  const [scope, setScope] = useState<DiffScope>(readDiffScope);
  const [workspaces, setWorkspaces] = useState<WorkspaceDiff[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const userPickedScope = useRef(false);

  // Comments only decide how a fetched diff is presented. They arrive as a new
  // array with every websocket snapshot, so they are read through a ref: as a
  // dependency they re-created `load` on every streamed log line and reloaded
  // the tab out from under whoever was reading it.
  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // The folders on screen, for an `expand` that was given only a path.
  const foldersRef = useRef<string[]>([]);
  useEffect(() => {
    foldersRef.current = (workspaces || []).map((workspace) => workspace.cwd);
  }, [workspaces]);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const next = await api.getDiff(taskId, scope, sessionId);
      setWorkspaces(next.workspaces);
      const current = commentsRef.current;
      const commented = new Set(
        current.map((comment) => fileKey(comment.cwd || '', comment.path))
      );
      const commentedPaths = new Set(current.filter((c) => !c.cwd).map((c) => c.path));
      setCollapsed((prev) => {
        const collapsedNext = { ...prev };
        for (const workspace of next.workspaces) {
          for (const file of workspace.files) {
            const key = fileKey(workspace.cwd, file.path);
            if (commented.has(key) || commentedPaths.has(file.path)) collapsedNext[key] = false;
            else if (workspace.files.length > COLLAPSE_ABOVE && !(key in collapsedNext)) {
              collapsedNext[key] = true;
            }
          }
        }
        return collapsedNext;
      });
      // Review notes live on the branch changelog more often than the dirty tree.
      const readable = next.workspaces.filter((workspace) => !workspace.error);
      if (
        !userPickedScope.current
        && scope === 'uncommitted'
        && readable.length > 0
        && readable.every((workspace) => workspace.files.length === 0)
        && current.length > 0
      ) {
        writeDiffScope('branch');
        setScope('branch');
      }
    } catch (e) {
      reportError('Could not load the diff', e);
      setWorkspaces(null);
    } finally {
      setLoading(false);
    }
  }, [taskId, sessionId, scope]);

  // The spinner belongs to a switch the user made — task, session, or scope.
  useEffect(() => {
    void load(true);
  }, [load]);

  // Refreshed on a timer while a turn is in flight, and once more when it ends.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        void load(false);
      }
      return;
    }
    wasRunning.current = true;
    const id = window.setInterval(() => void load(false), LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [running, load]);

  return {
    scope,
    workspaces,
    loading,
    pickScope: (value) => {
      userPickedScope.current = true;
      writeDiffScope(value);
      setScope(value);
    },
    reload: () => void load(true),
    isCollapsed: (cwd, path) => !!collapsed[fileKey(cwd, path)],
    toggle: (cwd, path) =>
      setCollapsed((prev) => ({ ...prev, [fileKey(cwd, path)]: !prev[fileKey(cwd, path)] })),
    expand: useCallback((path: string, cwd?: string) => {
      const folders = cwd ? [cwd] : foldersRef.current;
      setCollapsed((prev) => {
        const next = { ...prev };
        for (const folder of folders) next[fileKey(folder, path)] = false;
        return next;
      });
    }, [])
  };
}
