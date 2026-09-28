import { BoardTask, ProjectFolder } from '../../shared/types.js';
import { transcriptNamesPath } from '../../shared/transcript/openTargets.js';
import { DEFAULT_PERMISSION_MODE } from '../../shared/agent/permissions.js';
import { projectOwning } from '../../shared/board/projectPaths.js';
import { getSessionChangeSummary } from '../opencode/sessionList.js';
import { taskStore } from './taskStore.js';

/** Small reads over board state that more than one caller needs. */

/** Which OpenCode session each task has claimed, for the import list. */
export function claimedSessions(): Map<string, string> {
  return new Map(
    taskStore.getTasks().filter((t) => t.sessionId).map((t) => [t.sessionId as string, t.id])
  );
}

/** Fold the session's working-tree summary onto the task, if there is one. */
export function attachChangeSummary(taskId: string): BoardTask | null | undefined {
  const task = taskStore.getTask(taskId);
  if (!task?.sessionId) return task;
  const summary = getSessionChangeSummary(task.sessionId);
  if (!summary) return task;
  return taskStore.updateTask(taskId, { changeSummary: summary }) || task;
}

/** Task override wins; otherwise the board default. */
export function effectivePermissionMode(task: BoardTask) {
  return task.permissionMode || taskStore.getSettings().defaultPermissionMode || DEFAULT_PERMISSION_MODE;
}

/** The project a session belongs to, by explicit id or by containing path. */
export function projectFor(projectId?: string, cwd?: string): ProjectFolder | undefined {
  return projectOwning(taskStore.getSettings().projects, projectId, cwd);
}

/** The roots a file/mention search — and `POST /api/open` — is allowed to walk. */
export function boardRoots(): string[] {
  const settings = taskStore.getSettings();
  const roots = settings.projects.map((project) => project.path);
  if (settings.defaultCwd) roots.push(settings.defaultCwd);
  for (const task of taskStore.getTasks()) {
    if (task.cwd) roots.push(task.cwd);
    for (const link of task.sessions || []) {
      if (link.cwd) roots.push(link.cwd);
    }
  }
  return roots.filter(Boolean);
}

/**
 * Whether some transcript on the board named this exact path.
 *
 * The second gate on `POST /api/open`, after the board's folders: agents name
 * files that live outside every project — a log in `/tmp`, a config in the home
 * directory, a file in a repo nobody added — and the transcript turns those
 * into links. `taskId` narrows the scan to the transcript the link was clicked
 * in; without one, any task on the board will do, since the click still came
 * from something an agent wrote.
 */
export function transcriptsNamePath(target: string, taskId?: string): boolean {
  const named = taskId ? [taskStore.getTask(taskId)] : taskStore.getTasks();
  for (const task of named) {
    if (task && transcriptNamesPath(task.logs, target)) return true;
  }
  return false;
}
