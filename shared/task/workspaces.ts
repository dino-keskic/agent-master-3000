import { normalizeFolder, projectOwning } from '../board/projectPaths.js';
import { liveTaskSessions, sessionCwd } from './sessions.js';
import { BoardTask, ProjectFolder } from '../types.js';

/**
 * The folders one task's work is spread across.
 *
 * A task used to mean a folder, so the Changes tab could read that one folder
 * and be done. It no longer does: a session can be sent to another project or
 * another checkout, and a piece of work that touches two repositories — the API
 * and the app it serves — is one task with sessions in both. What changed is
 * therefore the union of what changed in each of those folders, and this says
 * which they are.
 *
 * The task's own folder leads, because it is where a plain follow-up runs; the
 * rest follow in the order their sessions were linked, so the list does not
 * reshuffle itself between two reads.
 */

export interface TaskWorkspace {
  /** Folder a turn runs in, with any trailing slash taken off. */
  cwd: string;
  /** The last segment of the folder: a project root's name, or a worktree's. */
  label: string;
  projectId?: string;
  projectName?: string;
  /** True when the folder is a sibling `<root>.worktrees/` checkout. */
  isWorktree: boolean;
  /** True for the folder the task itself runs in. */
  isTaskFolder: boolean;
  /** The sessions whose turns run here. Empty for a folder only the task names. */
  sessionIds: string[];
}

function folderLabel(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() || cwd;
}

function describe(
  cwd: string,
  projects: ProjectFolder[],
  projectId: string | undefined,
  isTaskFolder: boolean
): TaskWorkspace {
  const project = projectOwning(projects, projectId, cwd);
  const root = normalizeFolder(project?.path);
  return {
    cwd,
    label: folderLabel(cwd),
    projectId: project?.id,
    projectName: project?.name,
    isWorktree: !!root && cwd.startsWith(`${root}.worktrees/`),
    isTaskFolder,
    sessionIds: []
  };
}

/**
 * @param first a folder to put at the head of the list — the session on screen,
 *   so the Changes tab opens on the folder that session is working in.
 */
export function taskWorkspaces(
  task: Pick<BoardTask, 'cwd' | 'projectId' | 'sessionId' | 'sessions'>,
  projects: ProjectFolder[] = [],
  first?: string
): TaskWorkspace[] {
  const byCwd = new Map<string, TaskWorkspace>();

  const add = (rawCwd: string | undefined, projectId: string | undefined, sessionId?: string) => {
    const cwd = normalizeFolder(rawCwd);
    if (!cwd) return;
    let entry = byCwd.get(cwd);
    if (!entry) {
      entry = describe(cwd, projects, projectId, !sessionId);
      byCwd.set(cwd, entry);
    }
    if (sessionId && !entry.sessionIds.includes(sessionId)) entry.sessionIds.push(sessionId);
  };

  add(task.cwd, task.projectId);
  for (const link of liveTaskSessions(task)) {
    add(sessionCwd(task, link), link.projectId, link.sessionId);
  }

  const list = [...byCwd.values()];
  const head = normalizeFolder(first);
  const preferred = head ? list.findIndex((entry) => entry.cwd === head) : -1;
  if (preferred > 0) list.unshift(...list.splice(preferred, 1));
  return list;
}

/**
 * How a folder is named on screen. The project alone is not enough once two
 * checkouts of it are in the list, and the folder name alone is not enough once
 * two projects are — so it is whichever of those is actually in question.
 */
export function workspaceTitle(workspace: TaskWorkspace): string {
  if (!workspace.projectName) return workspace.label;
  if (workspace.projectName === workspace.label) return workspace.projectName;
  return `${workspace.projectName} · ${workspace.label}`;
}
