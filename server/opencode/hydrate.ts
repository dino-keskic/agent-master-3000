import { clipText, lastLogText } from '../../shared/sessions/list.js';
import { isPlaceholderSessionTitle } from '../../shared/format.js';
import { AcpSessionSummary } from '../../shared/sessions/types.js';
import { BoardTask, TaskSessionLink } from '../../shared/types.js';
import { listTaskSessions, recordedRunSettings } from '../../shared/task/sessions.js';
import { billedSessionCost, totalSessionCost } from '../../shared/sessions/cost.js';
import { modelInfoForSession } from './models.js';
import { CwdProbe, matchProjectName, probeDirectories, worktreeLabel } from './projects.js';
import { getOpenCodeSessionsById } from './sessionList.js';

let lastProbes = new Map<string, CwdProbe>();
let lastSessions = new Map<string, AcpSessionSummary>();
let lastProjects: { name: string; path: string; id?: string }[] = [];

/**
 * Refresh each linked session's cost and size from OpenCode's database.
 *
 * The link records what the board knew when the session was created; a fork
 * that has been working since then would otherwise show "$0" forever.
 */
function enrichSessionLinks(task: BoardTask, sessionsById: Map<string, AcpSessionSummary>): TaskSessionLink[] | undefined {
  if (!task.sessions || task.sessions.length === 0) return task.sessions;
  return task.sessions.map((link) => {
    const live = sessionsById.get(link.sessionId);
    if (!live) return link;
    const billed = billedSessionCost(link, live.cost, live.inheritedCost);
    const runsOn = recordedRunSettings(task, link, live);
    return {
      ...link,
      title: !isPlaceholderSessionTitle(live.title) ? live.title : (link.title || live.title),
      cost: billed > 0 ? billed : undefined,
      tokenCount: live.tokenCount ?? link.tokenCount,
      model: runsOn.model,
      agent: runsOn.agent,
      contextTokens: live.contextTokens ?? link.contextTokens,
      contextLimit: live.contextLimit ?? link.contextLimit,
      updatedAt: Math.max(link.updatedAt || 0, Date.parse(live.updatedAt) || 0) || link.updatedAt
    };
  });
}

/**
 * Keep the overlay's project list current between hydrate passes: a project
 * added a moment ago is one work can be moved into a moment later, and the
 * label on that work is read off this list.
 */
export function rememberProjects(projects: { name: string; path: string; id?: string }[]): void {
  lastProjects = projects;
}

export function overlayLiveStatus(
  task: BoardTask,
  probe?: CwdProbe,
  session?: AcpSessionSummary,
  projects: { name: string; path: string; id?: string }[] = lastProjects,
  sessionsById: Map<string, AcpSessionSummary> = lastSessions
): BoardTask {
  const label = worktreeLabel(task.cwd);
  const lastUser = clipText(task.lastUserMessage || lastLogText(task.logs, 'user_say') || task.prompt);
  const lastAgent = clipText(task.lastMessage || lastLogText(task.logs, 'agent_say'));
  // The task's own folder answers first: moving a task to another project
  // rewrites that folder, while the OpenCode session stays filed under the
  // project it was created in and would otherwise keep the old label on screen.
  const projectName = matchProjectName(task.cwd, projects)
    || session?.projectName
    || projects.find((project) => project.id && project.id === task.projectId)?.name;
  const dirtyFiles = label && probe?.dirty ? probe.dirtyFiles : [];
  const modelInfo = modelInfoForSession(session?.model || task.model);
  const sessions = enrichSessionLinks(task, sessionsById);
  const billed = sessions && sessions.length > 0
    ? totalSessionCost(sessions)
    : (session?.cost ?? task.cost);
  return {
    ...task,
    sessions,
    lastUserMessage: lastUser,
    lastMessage: lastAgent,
    tokenCount: session?.tokenCount ?? task.tokenCount,
    cost: billed && billed > 0 ? billed : undefined,
    subagentCount: session?.subagentCount ?? task.subagentCount,
    contextTokens: session?.contextTokens ?? task.contextTokens,
    contextLimit: session?.contextLimit ?? modelInfo?.contextLimit ?? task.contextLimit,
    changeSummary: session?.changeSummary || task.changeSummary,
    cwdExists: probe ? probe.exists : task.cwdExists,
    cwdDirty: dirtyFiles.length > 0,
    cwdDirtyFiles: dirtyFiles.length > 0 ? dirtyFiles : undefined,
    worktreeLabel: label,
    isWorktree: !!label,
    projectName
  };
}

export function withLiveStatus(task: BoardTask): BoardTask {
  return overlayLiveStatus(
    task,
    lastProbes.get(task.cwd),
    task.sessionId ? lastSessions.get(task.sessionId) : undefined
  );
}

export function cachedOpenCodeSession(sessionId: string): AcpSessionSummary | undefined {
  return lastSessions.get(sessionId);
}

/** Re-read cost/context for these sessions into the live overlay cache. */
export function refreshCachedSessions(ids: string[]): Map<string, AcpSessionSummary> {
  const fresh = getOpenCodeSessionsById(ids);
  for (const [id, summary] of fresh) lastSessions.set(id, summary);
  return fresh;
}

export async function hydrateTasks(tasks: BoardTask[], projects?: { name: string; path: string; id?: string }[]): Promise<BoardTask[]> {
  if (projects) lastProjects = projects;
  if (tasks.length === 0) return tasks;
  lastProbes = await probeDirectories(tasks.map((task) => task.cwd));
  // Every linked session, not just the primary one — the sidebar prices forks too.
  lastSessions = getOpenCodeSessionsById(
    tasks.flatMap((task) => listTaskSessions(task).map((link) => link.sessionId))
  );
  return tasks.map((task) =>
    overlayLiveStatus(
      task,
      lastProbes.get(task.cwd),
      task.sessionId ? lastSessions.get(task.sessionId) : undefined
    )
  );
}
