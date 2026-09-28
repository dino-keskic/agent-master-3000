import { BoardTask, TaskLogItem, TaskSessionLink } from '../../shared/types.js';
import { isSessionBusy, listTaskSessions, liveTaskSessions, sessionRunState } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { loadSessionHistory } from './history.js';
import { cachedOpenCodeSession, refreshCachedSessions } from './hydrate.js';
import { activeRootSessionIds } from './liveTurns.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';
import { TurnRegistry, turnKey } from '../turns/registry.js';

/**
 * Reconciling the board against OpenCode's own database.
 *
 * A session can run without this process: it was imported, or the user is
 * driving it from the OpenCode CLI. The board would otherwise freeze on
 * whatever it last saw, so a poll re-reads the DB and pushes the difference.
 */
export class OpenCodeSync {
  /** How far into each session's transcript the board has already read. */
  private readonly watermarks = new Map<string, number>();

  constructor(
    private readonly turns: TurnRegistry,
    private readonly publisher: BoardPublisher
  ) {}

  /**
   * Is a session's run state ours to overwrite from the DB? A turn we own, a
   * turn we are starting, a session blocked on the user, and one the user just
   * stopped are all states the database cannot see.
   */
  private isOursToJudge(taskId: string, sessionId: string, state: string): boolean {
    if (acpManager.isSessionTurnInFlight(sessionId)) return false;
    if (this.turns.isStarting(turnKey(taskId, sessionId))) return false;
    if (state === 'awaiting_input') return false;
    // An explicit Stop wins over leftover `running` parts in OpenCode's DB.
    if (this.turns.isStopped(sessionId)) return false;
    return true;
  }

  /**
   * OpenCode's database is the source of truth for "is this session still
   * working" after a board restart. Checked per session rather than per task,
   * so a fork left running is recovered as readily as a main session.
   */
  syncRunStates(): void {
    const pairs: { task: BoardTask; sessionId: string; link: TaskSessionLink }[] = [];
    for (const task of taskStore.getTasks()) {
      for (const link of liveTaskSessions(task)) {
        pairs.push({ task, sessionId: link.sessionId, link });
      }
    }
    if (pairs.length === 0) return;

    const active = activeRootSessionIds(pairs.map((pair) => pair.sessionId));
    for (const { task, sessionId, link } of pairs) {
      const state = link.runState ?? (sessionId === task.sessionId ? task.runState : 'idle');
      if (!this.isOursToJudge(task.id, sessionId, state)) continue;

      const ocActive = active.has(sessionId);
      if (ocActive && state !== 'running') this.adoptRunning(task.id, sessionId);
      else if (!ocActive && state === 'running') this.adoptIdle(task.id, sessionId);
    }
  }

  private adoptRunning(taskId: string, sessionId: string): void {
    const updated = taskStore.setSessionRunState(taskId, sessionId, 'running');
    if (!updated) return;
    this.publisher.status(updated);
    if (sessionId === updated.sessionId) {
      void acpManager.bindExistingSession(updated).catch((e) => {
        console.warn(`[Server] Could not bind running session ${sessionId}:`, e?.message || e);
      });
    }
  }

  private adoptIdle(taskId: string, sessionId: string): void {
    const updated = taskStore.setSessionRunState(taskId, sessionId, 'idle');
    if (!updated) return;
    refreshCachedSessions([sessionId]);
    this.publisher.status(updated);
  }

  /**
   * Pull OpenCode's own transcript into the board task.
   *
   * `incremental` reads only what has arrived since the last pass; a full read
   * is what opening a task does, since the client may have nothing cached.
   */
  resyncTask(
    taskId: string,
    { incremental = false }: { incremental?: boolean } = {}
  ): { task: BoardTask; changed: TaskLogItem[] } | null {
    const task = taskStore.getTask(taskId);
    if (!task) return null;

    const links = liveTaskSessions(task);
    const merged = this.mergeIncomingLogs(taskId, task, links, incremental);
    if (!merged) return null;

    const sessionIds = links.map((link) => link.sessionId);
    if (sessionIds.length > 0) refreshCachedSessions(sessionIds);

    this.reconcileLinkStates(taskId, merged.task, links, sessionIds);

    const live = taskStore.getTask(taskId) || merged.task;
    return { task: live, changed: merged.changed };
  }

  /** Read each session's new transcript entries and fold them into the task. */
  private mergeIncomingLogs(
    taskId: string,
    task: BoardTask,
    links: TaskSessionLink[],
    incremental: boolean
  ): { task: BoardTask; changed: TaskLogItem[] } | null {
    const incoming: TaskLogItem[] = [];
    for (const link of links) {
      const since = incremental ? (this.watermarks.get(link.sessionId) ?? 0) : 0;
      const history = loadSessionHistory(link.sessionId, since);
      if (history.watermark) this.watermarks.set(link.sessionId, history.watermark);
      for (const log of history.logs) {
        incoming.push({ ...log, sessionId: link.sessionId });
      }
    }
    if (incoming.length === 0) return { task, changed: [] };
    return taskStore.mergeLogs(taskId, incoming);
  }

  /** Bring each session link's run state back in line with the database. */
  private reconcileLinkStates(
    taskId: string,
    latest: BoardTask,
    links: TaskSessionLink[],
    sessionIds: string[]
  ): void {
    const active = sessionIds.length > 0 ? activeRootSessionIds(sessionIds) : new Set<string>();
    const stoppedIds = sessionIds.filter((sessionId) => this.turns.isStopped(sessionId));
    if (stoppedIds.length > 0) taskStore.failLiveTools(taskId, stoppedIds);

    for (const link of links) {
      const state = sessionRunState(latest, link);
      if (!this.isOursToJudge(taskId, link.sessionId, state)) continue;
      const ocActive = active.has(link.sessionId);
      if (ocActive && state !== 'running') {
        taskStore.setSessionRunState(taskId, link.sessionId, 'running');
      } else if (!ocActive && state === 'running') {
        taskStore.setSessionRunState(taskId, link.sessionId, 'idle');
        // OpenCode says that session is done; a tool it left in flight is not
        // waiting on anything any more.
        taskStore.sweepStaleTools(taskId);
      }
    }
  }

  /** Sessions OpenCode still owns — we do not have an ACP turn in flight. */
  refreshOwnedTranscripts(): void {
    const seen = new Set<string>();
    for (const task of taskStore.getTasks()) {
      const needs = liveTaskSessions(task).some((link) => {
        if (acpManager.isSessionTurnInFlight(link.sessionId)) return false;
        return isSessionBusy(sessionRunState(task, link));
      });
      if (!needs || seen.has(task.id)) continue;
      seen.add(task.id);
      const result = this.resyncTask(task.id, { incremental: true });
      if (result && result.changed.length > 0) {
        this.publisher.logBatch(task.id, result.changed, result.task);
      }
    }
  }

  /** Push the cards whose cost or context window moved since the last tick. */
  refreshRunningSpend(): void {
    const ids: string[] = [];
    const taskBySession = new Map<string, string>();
    for (const task of taskStore.getTasks()) {
      for (const link of listTaskSessions(task)) {
        if (isSessionBusy(link.runState) || acpManager.isSessionTurnInFlight(link.sessionId)) {
          ids.push(link.sessionId);
          taskBySession.set(link.sessionId, task.id);
        }
      }
    }
    if (ids.length === 0) return;

    const before = new Map(ids.map((id) => [id, spendFingerprint(id)]));
    refreshCachedSessions(ids);

    const dirtyTasks = new Set<string>();
    for (const id of ids) {
      if (spendFingerprint(id) === before.get(id)) continue;
      const taskId = taskBySession.get(id);
      if (taskId) dirtyTasks.add(taskId);
    }
    for (const taskId of dirtyTasks) this.publisher.refresh(taskId);
  }

  /**
   * OpenCode generates a real session title after a few turns. Copy it onto the
   * card when the user has not typed one, so the board stops showing the prompt.
   */
  persistAdoptedTitles(tasks: BoardTask[] = taskStore.getTasks()): void {
    for (const task of tasks) {
      for (const link of listTaskSessions(task)) {
        const live = cachedOpenCodeSession(link.sessionId);
        if (!live?.title) continue;
        const updated = taskStore.adoptSessionTitle(task.id, link.sessionId, live.title);
        if (updated) this.publisher.updated(updated);
      }
    }
  }
}

/** What "the spend view of this session changed" means, as one comparable string. */
function spendFingerprint(sessionId: string): string {
  const live = cachedOpenCodeSession(sessionId);
  return `${live?.cost ?? ''}:${live?.contextTokens ?? ''}:${live?.contextLimit ?? ''}`;
}
