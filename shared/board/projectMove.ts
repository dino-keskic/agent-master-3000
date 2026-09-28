import { BoardTask, ProjectFolder, TaskSessionLink } from '../types.js';
import { ensureSessionLink } from '../task/sessionLinks.js';
import { listTaskSessions, sessionCwd } from '../task/sessions.js';
import { folderInProject, normalizeFolder, projectForFolder, projectOwning } from './projectPaths.js';

/**
 * Moving a task, or one of its sessions, to another project or checkout.
 *
 * A project is a folder, so a move is two writes that have to agree: the tag
 * the board filters on, and the working directory the next turn runs in.
 * Changing only the tag would leave the card labelled with a project it never
 * touches, because every label is read back off the folder — so a plan always
 * carries a cwd, and it keeps the folder it already has when that folder is
 * inside the target project (a worktree of it, say) rather than yanking the
 * work back to the root.
 *
 * A move can also name the folder outright, which is how the board switches
 * work between the worktrees of one project. A folder on its own is enough:
 * the project it belongs to is read off it, the same way every label is.
 *
 * The sessions come along by default: one running in the task's own folder has
 * no opinion of its own about where it lives, and leaving it pointing at the
 * old project is how a "moved" task keeps starting turns in the place it left.
 * A session that was deliberately put somewhere else stays there.
 *
 * Nothing here rewrites the past. The turn already in flight keeps running
 * where it started, and OpenCode still has the session filed under the project
 * it was created in; this decides where the *next* turn goes.
 */

/**
 * Where work is being sent. Either half may be given on its own: a project
 * alone means "wherever in it this work already is, else its root", a folder
 * alone means that exact checkout, under whichever project owns it.
 */
export interface MoveTarget {
  project?: ProjectFolder;
  cwd?: string;
}

/** New placement for one session link. An absent field clears what the link had. */
export interface SessionProjectPatch {
  sessionId: string;
  cwd?: string;
  projectId?: string;
  projectName?: string;
}

export interface TaskProjectMove {
  projectId?: string;
  cwd: string;
  /** Sessions carried along with the task. */
  sessions: SessionProjectPatch[];
  /** What the task's log should say about it. */
  log: string;
}

export interface SessionProjectMove {
  patch: SessionProjectPatch;
  log: string;
}

/**
 * What a move did, alongside the task it changed. The log line is stripped out
 * of a published snapshot, and it is the one sentence that says where the work
 * went — so the response carries it for whoever asked.
 */
export interface MoveResult {
  log: string;
  /** The session that moved, when it was a session that moved. */
  sessionId?: string;
}

export interface SessionMoveOptions {
  /**
   * The session is mid-turn. The move still stands — the running turn resolved
   * its folder when it started — but the log says when it will be felt.
   */
  turnInFlight?: boolean;
}

/** Nothing to aim at: neither a project nor a folder was named. */
function isEmpty(target: MoveTarget | undefined): boolean {
  return !target?.project && !normalizeFolder(target?.cwd);
}

/**
 * The folder work lands in, and the project that owns it.
 *
 * A named folder wins outright; otherwise the target project takes the work
 * where it already is inside it, and only pulls it to the root when it is not
 * in the project at all.
 */
function resolveTarget(
  current: string,
  target: MoveTarget | undefined,
  projects: ProjectFolder[]
): { cwd: string; project?: ProjectFolder } {
  if (isEmpty(target)) return { cwd: normalizeFolder(current) };

  const named = normalizeFolder(target?.cwd);
  const project = target?.project;
  if (named) return { cwd: named, project: project || projectForFolder(named, projects) };

  const root = project as ProjectFolder;
  return { cwd: folderInProject(current, root.path) ? normalizeFolder(current) : normalizeFolder(root.path), project: root };
}

function patchChangesLink(link: TaskSessionLink, patch: SessionProjectPatch): boolean {
  return normalizeFolder(link.cwd) !== normalizeFolder(patch.cwd)
    || link.projectId !== patch.projectId
    || link.projectName !== patch.projectName;
}

/**
 * A session moves with its task when it is working in the task's folder — or
 * has no folder of its own, in which case it follows `task.cwd` wherever that
 * goes and only its stale project label needs correcting. Archived sessions
 * are history and keep the record of where they actually ran.
 */
function sessionsFollowing(task: BoardTask): TaskSessionLink[] {
  return listTaskSessions(task).filter(
    (link) => !link.archivedAt && (!link.cwd || normalizeFolder(link.cwd) === normalizeFolder(task.cwd))
  );
}

/**
 * Where a task and its live sessions end up, or `null` when they are already
 * there. An empty target means "no project": the tag is dropped and the folder
 * stays put, since there is nowhere else to run.
 */
export function planTaskProjectMove(
  task: BoardTask,
  target: MoveTarget | undefined,
  projects: ProjectFolder[]
): TaskProjectMove | null {
  const from = projectOwning(projects, task.projectId, task.cwd);
  const { cwd, project } = resolveTarget(task.cwd, target, projects);
  const projectId = project?.id;

  const sessions: SessionProjectPatch[] = [];
  for (const link of sessionsFollowing(task)) {
    const patch: SessionProjectPatch = {
      sessionId: link.sessionId,
      // A link with no folder of its own keeps none; it rides on task.cwd.
      cwd: link.cwd ? cwd : undefined,
      projectId,
      projectName: project?.name
    };
    if (patchChangesLink(link, patch)) sessions.push(patch);
  }

  if (projectId === task.projectId && cwd === normalizeFolder(task.cwd) && sessions.length === 0) return null;

  return { projectId, cwd, sessions, log: taskMoveLog(project, from, cwd, normalizeFolder(task.cwd)) };
}

function taskMoveLog(
  target: ProjectFolder | undefined,
  from: ProjectFolder | undefined,
  cwd: string,
  previousCwd: string
): string {
  if (!target) {
    if (cwd !== previousCwd) return `Turns now run in ${cwd}.`;
    return from ? `Removed from project ${from.name}.` : 'Removed from its project.';
  }
  if (cwd === previousCwd) return `Moved to project ${target.name}.`;
  const verb = target.id === from?.id ? `Moved within ${target.name}` : `Moved to project ${target.name}`;
  return `${verb} — turns now run in ${cwd}.`;
}

/**
 * Where one session ends up, or `null` when it is already there or the task has
 * no such session. An empty target puts the session back on the task's own
 * project and folder, which is also what a move that lands exactly there does —
 * a link with nothing of its own to say says nothing.
 */
export function planSessionProjectMove(
  task: BoardTask,
  sessionId: string,
  target: MoveTarget | undefined,
  projects: ProjectFolder[],
  options: SessionMoveOptions = {}
): SessionProjectMove | null {
  const link = listTaskSessions(task).find((entry) => entry.sessionId === sessionId);
  if (!link) return null;

  const { cwd, project } = resolveTarget(sessionCwd(task, link), target, projects);
  const followsTask = isEmpty(target) || (cwd === normalizeFolder(task.cwd) && project?.id === task.projectId);
  const patch: SessionProjectPatch = followsTask
    ? { sessionId }
    : { sessionId, cwd, projectId: project?.id, projectName: project?.name };

  if (!patchChangesLink(link, patch)) return null;

  const title = link.title || 'Session';
  const moved = followsTask
    ? `Session "${title}" now follows the task's project.`
    : `Session "${title}" moved to ${project ? `project ${project.name} (${cwd})` : cwd}.`;
  return { patch, log: options.turnInFlight ? `${moved} It takes effect on the next turn.` : moved };
}

/** Puts a planned session placement on the link, creating the link if it was implicit. */
export function applySessionProjectPatch(task: BoardTask, patch: SessionProjectPatch): void {
  const link = ensureSessionLink(task, patch.sessionId);
  link.cwd = patch.cwd;
  link.projectId = patch.projectId;
  link.projectName = patch.projectName;
  link.updatedAt = Date.now();
}

export function applyTaskProjectMove(task: BoardTask, move: TaskProjectMove): void {
  task.projectId = move.projectId;
  task.cwd = move.cwd;
  for (const patch of move.sessions) applySessionProjectPatch(task, patch);
  task.updatedAt = Date.now();
}
