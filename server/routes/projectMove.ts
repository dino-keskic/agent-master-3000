import { Express, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { MoveResult, MoveTarget } from '../../shared/board/projectMove.js';
import { folderInCheckouts, folderInProject, normalizeFolder } from '../../shared/board/projectPaths.js';
import { listTaskSessions, sessionCwd } from '../../shared/task/sessions.js';
import { BoardTask, ProjectFolder } from '../../shared/types.js';
import { acpManager } from '../acp/client.js';
import { boardRoots } from '../board/queries.js';
import { listWorktrees } from '../git/worktree.js';
import { IdParams, SessionParams, route } from '../http/app.js';
import { resolveWithinRoots } from '../app/openExternal.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';
import { RouteContext } from './context.js';

/**
 * Reassigning work to another project or checkout.
 *
 * A project is a folder, so this is not a field update: it moves where the
 * next turn runs. That is why it lives here rather than in the task PATCH —
 * it carries the task's sessions along, writes a line in the log saying where
 * everything went, and refuses a whole-task move while a turn is in flight,
 * since the folder a running agent is working in must not change underneath it.
 *
 * A single session may be moved mid-turn: the running turn resolved its folder
 * when it started and keeps it, so the move is felt on the next one. That is
 * what lets an agent send its own session to another worktree.
 */

interface MoveBody {
  projectId?: unknown;
  cwd?: unknown;
}

type TargetRead = { ok: true; target?: MoveTarget } | { ok: false; error: string };

/** The checkouts of a project that can be worked in, as git reports them. */
async function projectCheckouts(project: ProjectFolder): Promise<string[]> {
  return (await listWorktrees(project.path))
    .filter((entry) => !entry.bare && !entry.prunable)
    .map((entry) => entry.path);
}

/**
 * Whether the board may run a turn in this folder.
 *
 * A checkout is the project, wherever it sits: the board's own worktrees land
 * beside the project folder, but OpenCode keeps its under `~/.local/share`, and
 * one cut for a pull request can sit in a temp folder. Path shape cannot tell
 * those from a stranger's folder, so git is asked — the same list the picker
 * offered in the first place, which is why this used to refuse a checkout the
 * board had just shown.
 */
async function folderIsWorkable(cwd: string, project?: ProjectFolder): Promise<boolean> {
  if (project) {
    return folderInProject(cwd, project.path) || folderInCheckouts(cwd, await projectCheckouts(project));
  }
  if (resolveWithinRoots(cwd, boardRoots())) return true;
  const projects = taskStore.getSettings().projects;
  if (projects.some((entry) => folderInProject(cwd, entry.path))) return true;
  for (const entry of projects) {
    if (folderInCheckouts(cwd, await projectCheckouts(entry))) return true;
  }
  return false;
}

/**
 * The project and folder a move names. `projectId` null or absent means no
 * project; `cwd` names a checkout — a worktree of the project, usually — and
 * has to be a real folder the board already works in, since a turn will be run
 * there.
 */
async function readTarget(body: MoveBody | null | undefined): Promise<TargetRead> {
  const { projectId, cwd } = body || {};
  if (projectId !== null && projectId !== undefined && typeof projectId !== 'string') {
    return { ok: false, error: 'projectId must be a string or null' };
  }
  const project = typeof projectId === 'string'
    ? taskStore.getSettings().projects.find((entry) => entry.id === projectId)
    : undefined;
  if (typeof projectId === 'string' && !project) return { ok: false, error: 'Unknown project' };

  if (cwd === null || cwd === undefined || cwd === '') return { ok: true, target: { project } };
  if (typeof cwd !== 'string') return { ok: false, error: 'cwd must be a string' };

  const resolved = path.resolve(cwd);
  if (!fs.existsSync(resolved)) return { ok: false, error: 'That folder does not exist' };
  if (!(await folderIsWorkable(resolved, project))) {
    return {
      ok: false,
      error: project
        ? `That folder is not a checkout of ${project.name}`
        : 'That folder is outside every folder added to the board'
    };
  }

  return { ok: true, target: { project, cwd: normalizeFolder(resolved) } };
}

/**
 * The move's log line cannot ride along in a stripped snapshot, so it goes out
 * as a delta to the board — and back to the caller beside the task, since it is
 * the only place the move says in words what it did.
 */
function publishWithLog(
  publisher: BoardPublisher,
  task: BoardTask,
  logsBefore: number,
  sessionId?: string
): BoardTask & { move?: MoveResult } {
  const presented = publisher.updated(task);
  const entry = task.logs.length > logsBefore ? task.logs[task.logs.length - 1] : undefined;
  if (!entry) return presented;
  publisher.logDelta(task.id, entry);
  return { ...presented, move: { log: entry.text, sessionId } };
}

/**
 * `current` stands for the session this turn is running in, which is the only
 * name an agent moving itself can know: the board hands its MCP server a task
 * id, and the session it is talking through was created after that.
 */
function readSessionId(task: BoardTask, param: string): { ok: true; sessionId: string } | { ok: false; error: string } {
  if (param !== 'current') {
    return listTaskSessions(task).some((link) => link.sessionId === param)
      ? { ok: true, sessionId: param }
      : { ok: false, error: 'That session is not linked to this task' };
  }
  const running = acpManager.inFlightSessions(task.id);
  if (running.length === 1 && running[0]) return { ok: true, sessionId: running[0] };
  if (running.length > 1) {
    return { ok: false, error: 'This task has several turns running — name the session to move' };
  }
  const active = task.activeSessionId || task.sessionId;
  return active
    ? { ok: true, sessionId: active }
    : { ok: false, error: 'This task has no session to move' };
}

/**
 * Everywhere this task could run, and where it runs now.
 *
 * The checkouts are read per project with git, so this is a request the caller
 * makes when it is about to choose — not something the board keeps polling.
 */
async function moveTargets(task: BoardTask): Promise<unknown> {
  const projects = taskStore.getSettings().projects;
  const running = new Set(acpManager.inFlightSessions(task.id));

  return {
    current: { cwd: task.cwd, projectId: task.projectId, projectName: task.projectName },
    sessions: listTaskSessions(task)
      .filter((link) => !link.archivedAt)
      .map((link) => ({
        sessionId: link.sessionId,
        title: link.title,
        cwd: sessionCwd(task, link),
        projectName: link.projectName || task.projectName,
        primary: link.sessionId === task.sessionId,
        running: running.has(link.sessionId)
      })),
    projects: await Promise.all(projects.map(async (project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      checkouts: (await listWorktrees(project.path))
        .filter((entry) => !entry.bare && !entry.prunable)
        .map((entry) => ({ path: entry.path, branch: entry.branch }))
    })))
  };
}

export function registerProjectMoveRoutes(app: Express, { publisher, orchestrator }: RouteContext): void {
  /** The projects and checkouts a move can name, for whoever is choosing one. */
  app.get('/api/tasks/:id/move-targets', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(await moveTargets(task));
  }));

  /** Move the task, and with it every session that was working in its folder. */
  app.post('/api/tasks/:id/project', route(async (req: Request<IdParams>, res: Response) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const target = await readTarget(req.body);
    if (!target.ok) return res.status(400).json({ error: target.error });
    if (orchestrator.hasBusyWork(task)) {
      return res.status(409).json({ error: 'Stop this task before moving it to another project' });
    }

    const logsBefore = task.logs.length;
    const moved = taskStore.moveTaskToProject(task.id, target.target);
    if (!moved) return res.status(404).json({ error: 'Task not found' });
    res.json(publishWithLog(publisher, moved, logsBefore));
  }));

  /**
   * Move one session, leaving the task where it is. An empty target gives the
   * session back to the task's own project rather than putting it nowhere.
   */
  app.post('/api/tasks/:id/sessions/:sessionId/project', route(async (req: Request<SessionParams>, res: Response) => {
    const { id } = req.params;
    const task = taskStore.getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const session = readSessionId(task, req.params.sessionId);
    if (!session.ok) return res.status(404).json({ error: session.error });

    const target = await readTarget(req.body);
    if (!target.ok) return res.status(400).json({ error: target.error });

    const logsBefore = task.logs.length;
    const moved = taskStore.moveSessionToProject(id, session.sessionId, target.target, {
      turnInFlight: orchestrator.isTurnBusy(id, session.sessionId)
    });
    if (!moved) return res.status(404).json({ error: 'Task not found' });
    res.json(publishWithLog(publisher, moved, logsBefore, session.sessionId));
  }));
}
