import { newId } from '../../shared/ids.js';
import { columnConfigPatch, findColumn } from '../../shared/board/columns.js';
import { MAX_TASK_LOGS, failLiveTools } from '../../shared/task/logs.js';
import { applyLogToTask, mergeLogsIntoTask } from '../../shared/task/logWrites.js';
import { isAutoTaskTitle, isPlaceholderSessionTitle } from '../../shared/format.js';
import { allocateTaskId } from '../../shared/board/normalize.js';
import { archivedTasks, isArchived, liveTasks, restoreColumnId } from '../../shared/task/archive.js';
import { sweepStaleTools } from '../../shared/agent/staleTools.js';
import { buildTask, NewTaskInput, patchTask } from '../../shared/task/factory.js';
import {
  applyLinkedSession,
  archiveStageLink,
  clearLinkPendingRequests,
  ensureSessionLink,
  LinkedSessionInput,
  promotePrimarySession,
  recordStageEntry,
  setLinkChoice,
  setLinkPendingRequest,
  setLinkRunState,
  upsertSessionLink
} from '../../shared/task/sessionLinks.js';
import {
  appendChangelogComment,
  applyChangelogResponses,
  removeChangelogComment
} from '../../shared/review/changelogWrites.js';
import { addTaskLinks, patchTaskLink, removeTaskLink } from '../../shared/task/linkWrites.js';
import { applyLinkStatuses, LinkStatusPatch } from '../../shared/trackers/linkStatus.js';
import {
  MoveTarget,
  SessionMoveOptions,
  applySessionProjectPatch,
  applyTaskProjectMove,
  planSessionProjectMove,
  planTaskProjectMove
} from '../../shared/board/projectMove.js';
import { ChangelogResponse, ChangelogResponseResult } from '../../shared/review/agentResponses.js';
import { NewChangelogComment } from '../../shared/review/changelogComments.js';
import { NewTaskLink, TaskLinkMergeResult } from '../../shared/task/links.js';
import {
  BoardTask,
  ChangelogAuthor,
  PendingRequest,
  SessionChoice,
  TaskLinkSource,
  TaskLogItem,
  TaskRunState,
  TaskSessionLink
} from '../../shared/types.js';
import { BoardDocument } from './document.js';

// Re-exported so the store and the client's delta merge cannot drift apart.
export { MAX_TASK_LOGS };
export type { LinkedSessionInput, NewTaskInput };

/**
 * Every write the board makes to a task.
 *
 * The store owns *when* things are written — which task a change lands on, and
 * whether it is worth an immediate save. What a change means is decided in
 * `shared/`: `task/factory` builds and patches tasks, `task/sessionLinks` keeps
 * the per-session bookkeeping straight, `task/logWrites` folds transcript rows
 * in, `review/changelogWrites` and `task/linkWrites` handle the annotations. That split is
 * what makes the board's rules testable without a filesystem.
 *
 * It is past the size a file usually earns, and stays one file on purpose: it
 * is a single API — the one place a task is mutated — and every method here is
 * a few lines of "find the task, call the rule, save". Splitting it would only
 * make callers hunt for which half a write lives in.
 */
export class TaskStore extends BoardDocument {
  // --- tasks ---

  /**
   * Never derive ids from the task count: deletes make it repeat, and it
   * collided with seeded tasks. A caller-supplied id is honoured only when it
   * is actually free.
   */
  private claimTaskId(requested?: string): string {
    if (requested && !this.state.tasks.some((task) => task.id === requested)) return requested;
    if (requested) {
      console.warn(`[Store] Requested task id "${requested}" is already in use; allocating a new one`);
    }
    return allocateTaskId(this.state);
  }

  public createTask(input: NewTaskInput): BoardTask {
    const task = buildTask(input, this.state.settings, this.claimTaskId(input.id));
    this.state.tasks.push(task);
    this.save();
    return task;
  }

  public updateTask(taskId: string, updates: Partial<BoardTask>): BoardTask | null {
    const index = this.state.tasks.findIndex((task) => task.id === taskId);
    const current = index >= 0 ? this.state.tasks[index] : undefined;
    if (!current) return null;

    const updated = patchTask(current, updates);
    this.state.tasks[index] = updated;
    this.save();
    return updated;
  }

  // --- archive ---

  /** The board: what the kanban draws and what every count is taken from. */
  public listLiveTasks(): BoardTask[] {
    return liveTasks(this.state.tasks);
  }

  /** The recovery list, newest archive first. */
  public listArchivedTasks(): BoardTask[] {
    return archivedTasks(this.state.tasks);
  }

  /**
   * Take a task off the board without losing it. Nothing is removed — logs,
   * sessions, comments and links stay exactly where they were, so a restore is
   * this same field going away again.
   */
  public archiveTask(taskId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (isArchived(task)) return task;

    task.archivedAt = Date.now();
    task.updatedAt = task.archivedAt;
    // The caller has already stopped the turns and closed the sessions, so a
    // link left reading "running" is a state nothing could ever report out of —
    // the same reason `archiveLink` idles a retired session.
    task.runState = task.runState === 'error' ? 'error' : 'idle';
    task.pendingRequest = undefined;
    for (const link of task.sessions || []) {
      if (link.runState && link.runState !== 'error') link.runState = 'idle';
      link.pendingRequest = undefined;
    }
    // Idling the links makes every tool they still had in flight an orphan.
    task.logs = sweepStaleTools(task).logs;
    this.noteStatus(task, 'Archived', 'Archived off the board. Restore it from the archive.');
    this.save();
    return task;
  }

  /**
   * Put an archived task back. It returns to its own column, or to the first
   * one when that column was edited away while it sat in the archive — see
   * `restoreColumnId`.
   */
  public restoreTask(taskId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !isArchived(task)) return null;

    const columnId = restoreColumnId(task, this.state.settings.columns);
    const rehomed = columnId !== task.columnId;
    task.columnId = columnId;
    task.archivedAt = undefined;
    task.updatedAt = Date.now();
    const column = findColumn(this.state.settings.columns, columnId);
    this.noteStatus(
      task,
      'Restored',
      rehomed
        ? `Restored to ${column?.title || columnId}; the column it was archived from is gone.`
        : 'Restored to the board.'
    );
    this.save();
    return task;
  }

  /**
   * Gone for good. Only offered from the archive view, so a task can never
   * reach this without having been archived — and looked at — first.
   */
  public deleteTask(taskId: string): boolean {
    const index = this.state.tasks.findIndex((task) => task.id === taskId);
    if (index === -1) return false;
    this.state.tasks.splice(index, 1);
    this.save();
    return true;
  }

  /** Archives every live task in the column. Returns the ids that were archived. */
  public archiveTasksInColumn(columnId: string): string[] {
    const ids = this.liveTaskIdsInColumn(columnId);
    for (const id of ids) this.archiveTask(id);
    return ids;
  }

  /** Clearing a column must not re-archive what is already in the archive. */
  public liveTaskIdsInColumn(columnId: string): string[] {
    return this.listLiveTasks().filter((task) => task.columnId === columnId).map((task) => task.id);
  }

  public moveTask(taskId: string, columnId: string, options?: { applyConfig?: boolean }): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const column = findColumn(this.state.settings.columns, columnId);
    if (!column) return null;
    if (task.columnId === columnId) return task;

    const fromId = task.columnId;
    const previous = findColumn(this.state.settings.columns, fromId);
    task.columnId = columnId;
    // Columns that do not demand a fresh session carry the same conversation
    // into the next stage. Record the crossing so the task's spend can be split
    // at it rather than billed entirely to the column the session started in.
    recordStageEntry(task, columnId);
    if (options?.applyConfig) Object.assign(task, columnConfigPatch(column));
    task.updatedAt = Date.now();
    this.noteStatus(task, 'Moved', `Moved from ${previous?.title || fromId} to ${column.title}.`);
    this.save();
    return task;
  }

  /** A line in the task's own log about something the board did to it. */
  private noteStatus(task: BoardTask, title: string, text: string): void {
    task.logs.push({ id: newId(), timestamp: Date.now(), type: 'status_change', title, text });
  }

  /**
   * Send a task to another project or checkout — the tag the board filters on,
   * the folder the next turn runs in, and the sessions that were following the
   * task, in one write. An empty target leaves it in no project, keeping its
   * folder.
   */
  public moveTaskToProject(taskId: string, target: MoveTarget | undefined): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const move = planTaskProjectMove(task, target, this.state.settings.projects || []);
    if (!move) return task;
    applyTaskProjectMove(task, move);
    this.noteStatus(task, 'Project', move.log);
    this.save();
    return task;
  }

  /** Send one session to another project or checkout, leaving the task where it is. */
  public moveSessionToProject(
    taskId: string,
    sessionId: string,
    target: MoveTarget | undefined,
    options: SessionMoveOptions = {}
  ): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const move = planSessionProjectMove(task, sessionId, target, this.state.settings.projects || [], options);
    if (!move) return task;
    applySessionProjectPatch(task, move.patch);
    task.updatedAt = Date.now();
    this.noteStatus(task, 'Project', move.log);
    this.save();
    return task;
  }

  public setLastRunColumnId(taskId: string, columnId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (task.lastRunColumnId === columnId) return task;
    task.lastRunColumnId = columnId;
    task.updatedAt = Date.now();
    this.save(false);
    return task;
  }

  public setRunState(taskId: string, runState: TaskRunState): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (task.runState === runState) return task;
    task.runState = runState;
    if (runState === 'running') task.error = undefined;
    task.updatedAt = Date.now();
    this.save();
    return task;
  }

  /**
   * OpenCode generated a session title. The link always takes it; the card
   * takes it only while its own title is still the one derived from the
   * prompt. Once the task is named — by the user, or by its first session —
   * a fresh session taking over as main must not rename it.
   *
   * Leaves `updatedAt` alone: every board load runs this over every task, and
   * copying a title across is bookkeeping, not something that happened to the
   * task. Bumping it here filled "Updated today" with untouched tasks.
   */
  public adoptSessionTitle(taskId: string, sessionId: string, title: string): BoardTask | null {
    const trimmed = title.replace(/\s+/g, ' ').trim();
    if (!trimmed || isPlaceholderSessionTitle(trimmed)) return null;

    const task = this.getTask(taskId);
    if (!task) return null;

    const link = ensureSessionLink(task, sessionId);
    let changed = false;
    if (link.title !== trimmed) {
      link.title = trimmed;
      changed = true;
    }
    if (sessionId === task.sessionId && isAutoTaskTitle(task) && task.title !== trimmed) {
      task.title = trimmed;
      changed = true;
    }
    if (!changed) return null;
    this.save();
    return task;
  }

  // --- sessions ---

  public addLinkedSession(taskId: string, link: TaskSessionLink): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    upsertSessionLink(task, link);
    this.save();
    return task;
  }

  /** Records what one session is doing; the task's own state follows from it. */
  public setSessionRunState(taskId: string, sessionId: string, runState: TaskRunState): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (setLinkRunState(task, sessionId, runState)) this.save();
    return task;
  }

  public setSessionError(taskId: string, sessionId: string, error: string | undefined): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const link = ensureSessionLink(task, sessionId);
    link.error = error;
    link.updatedAt = Date.now();
    task.error = error ?? task.error;
    task.updatedAt = Date.now();
    this.save();
    return task;
  }

  /**
   * Parks or clears the request the agent is blocked on. Prefer the session
   * form: a task-level park is only the fallback when no session exists yet.
   */
  public setPendingRequest(taskId: string, request: PendingRequest | undefined): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    if (task.sessionId) return this.setSessionPendingRequest(taskId, task.sessionId, request);
    if (!task.pendingRequest && !request) return task;

    task.pendingRequest = request;
    if (request) {
      task.runState = 'awaiting_input';
    } else if (task.runState === 'awaiting_input') {
      task.runState = 'running';
    }
    task.updatedAt = Date.now();
    this.save();
    return task;
  }

  /**
   * Parks or clears the request one session is blocked on. Without a session id
   * this falls back to the primary one, which is what an elicitation that
   * arrived with no session attribution belongs to.
   */
  public setSessionPendingRequest(
    taskId: string,
    sessionId: string | undefined,
    request: PendingRequest | undefined
  ): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;

    const targetId = sessionId || task.sessionId;
    if (!targetId) return this.setPendingRequest(taskId, request);
    if (setLinkPendingRequest(task, targetId, request)) this.save();
    return task;
  }

  /** Clears whatever any session of this task was blocked on. */
  public clearPendingRequests(taskId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    clearLinkPendingRequests(task);
    this.save();
    return task;
  }

  public switchActiveSession(taskId: string, sessionId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    task.activeSessionId = sessionId;
    task.updatedAt = Date.now();
    this.save(false);
    return task;
  }

  /**
   * Promote a session to primary — the one plain follow-ups and column auto-runs
   * target. The session it replaces stays linked and readable, archived so the
   * list shows it as history rather than as somewhere still being worked.
   */
  public setPrimarySession(
    taskId: string,
    sessionId: string,
    options: { archivePrevious?: boolean } = {}
  ): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    promotePrimarySession(task, sessionId, options);
    this.save();
    return task;
  }

  /** Link a session that was just created or forked for this task. */
  public linkSession(taskId: string, input: LinkedSessionInput): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    applyLinkedSession(task, input);
    this.save();
    return task;
  }

  /**
   * Record what one session runs as. Per session, so picking a model while a
   * fork is on screen does not re-model the task's main conversation.
   */
  public setSessionChoice(taskId: string, sessionId: string, choice: SessionChoice): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    setLinkChoice(task, sessionId, choice);
    this.save();
    return task;
  }

  /** Retire this column's session, so the next stage turn starts a fresh one. */
  public archiveStageSession(taskId: string, fromColumnId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !task.sessionId) return task || null;
    archiveStageLink(task, task.sessionId, fromColumnId);
    this.save();
    return task;
  }

  // --- transcript ---

  public addLogToTask(taskId: string, logItem: TaskLogItem): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    applyLogToTask(task, logItem);
    this.save(false);
    return task;
  }

  /**
   * Fold OpenCode history into the transcript. Same id-merge as addLogToTask,
   * but one write, and the caller gets the rows that actually changed so it
   * can push them without re-reading the whole log.
   */
  public mergeLogs(taskId: string, incoming: TaskLogItem[]): { task: BoardTask; changed: TaskLogItem[] } | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const changed = mergeLogsIntoTask(task, incoming);
    if (changed.length > 0) this.save(false);
    return { task, changed };
  }

  /**
   * Stop leaves tool rows `in_progress` unless we mark them. Scope to a
   * session when only that conversation was cancelled.
   */
  public failLiveTools(
    taskId: string,
    sessionIds?: string[],
    message = 'Stopped'
  ): { task: BoardTask; changed: TaskLogItem[] } | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const { logs, changed } = failLiveTools(task.logs, sessionIds, message);
    if (changed.length === 0) return { task, changed };
    task.logs = logs;
    task.updatedAt = Date.now();
    this.save();
    return { task, changed };
  }

  /**
   * The same for tools nobody stopped: a turn that ended, a session that died
   * mid-call. `sweepStaleTools` decides which rows those are; this only writes
   * the result and reports the rows worth pushing.
   */
  public sweepStaleTools(taskId: string): { task: BoardTask; changed: TaskLogItem[] } | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const { logs, changed } = sweepStaleTools(task);
    if (changed.length === 0) return { task, changed };
    task.logs = logs;
    task.updatedAt = Date.now();
    this.save();
    return { task, changed };
  }

  // --- changelog comments ---

  public addChangelogComment(taskId: string, input: NewChangelogComment): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !appendChangelogComment(task, input)) return null;
    this.save();
    return task;
  }

  /**
   * Apply a batch of replies and resolutions in one write. The single-comment
   * calls below go through here too, so there is one place that decides what a
   * response does to a thread.
   */
  public applyChangelogResponses(
    taskId: string,
    responses: ChangelogResponse[],
    author: ChangelogAuthor = 'user'
  ): { task: BoardTask; result: ChangelogResponseResult } | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const result = applyChangelogResponses(task, responses, author);
    if (result.applied.length > 0) this.save();
    return { task, result };
  }

  public replyToChangelogComment(
    taskId: string,
    commentId: string,
    body: string,
    author: ChangelogAuthor = 'user'
  ): BoardTask | null {
    const outcome = this.applyChangelogResponses(taskId, [{ commentId, reply: body }], author);
    if (!outcome || outcome.result.applied.length === 0) return null;
    return outcome.task;
  }

  public resolveChangelogComment(taskId: string, commentId: string, resolved = true): BoardTask | null {
    const outcome = this.applyChangelogResponses(taskId, [
      { commentId, status: resolved ? 'resolved' : 'open' }
    ]);
    if (!outcome || outcome.result.applied.length === 0) return null;
    return outcome.task;
  }

  public deleteChangelogComment(taskId: string, commentId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !removeChangelogComment(task, commentId)) return null;
    this.save();
    return task;
  }

  // --- links ---

  /**
   * Add or update links in one write. Dedupe is by URL (see `mergeTaskLinks`),
   * so the same call can be made repeatedly — by the agent, or by a user
   * pasting a ticket twice — without the panel filling up with copies.
   */
  public addTaskLinks(
    taskId: string,
    inputs: NewTaskLink[],
    source: TaskLinkSource = 'user'
  ): { task: BoardTask; result: TaskLinkMergeResult; rejected: string[] } | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const { result, rejected } = addTaskLinks(task, inputs, source);
    if (result.added.length > 0 || result.updated.length > 0) this.save();
    return { task, result, rejected };
  }

  public updateTaskLink(
    taskId: string,
    linkId: string,
    patch: { title?: string; note?: string }
  ): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !patchTaskLink(task, linkId, patch)) return null;
    this.save();
    return task;
  }

  public deleteTaskLink(taskId: string, linkId: string): BoardTask | null {
    const task = this.getTask(taskId);
    if (!task || !removeTaskLink(task, linkId)) return null;
    this.save();
    return task;
  }

  /**
   * One write for a status refresh. Every task that was touched is saved;
   * only the ones a person would notice are returned, so a timestamp-only
   * pass does not repaint the board.
   */
  public applyLinkStatuses(byTask: Map<string, LinkStatusPatch[]>): BoardTask[] {
    const visible: BoardTask[] = [];
    let dirty = false;
    for (const [taskId, patches] of byTask) {
      const task = this.getTask(taskId);
      if (!task || patches.length === 0) continue;
      const outcome = applyLinkStatuses(task, patches);
      if (!outcome.touched) continue;
      dirty = true;
      if (outcome.visible) visible.push(task);
    }
    if (dirty) this.save();
    return visible;
  }
}

export const taskStore = new TaskStore();

process.on('exit', () => {
  try { taskStore.flush(); } catch { /* ignore */ }
});
