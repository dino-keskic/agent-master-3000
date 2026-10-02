import { BoardTask, TaskLogItem, TaskSessionLink } from '../../shared/types.js';
import { isSessionBusy, listTaskSessions, liveTaskSessions, sessionRunState } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { cachedOpenCodeSession, refreshCachedSessionsOffThread } from './hydrate.js';
import { BOARD_STARTED_AT } from './liveTurns.js';
import { readOffThread } from './readerThread.js';
import { BoardPublisher } from '../live/publisher.js';
import { taskStore } from '../board/taskStore.js';
import { TurnRegistry, turnKey } from '../turns/registry.js';

/**
 * Reconciling the board against OpenCode's own database.
 *
 * A session can run without this process: it was imported, or the user is
 * driving it from the OpenCode CLI. The board would otherwise freeze on
 * whatever it last saw, so a poll re-reads the DB and pushes the difference.
 *
 * Every read goes to the reader thread (`readerThread.ts`) and is awaited, so
 * the board can change while one is out: a turn starts, a task is archived.
 * Hence each decision below is made after its read lands, against the task as
 * the store holds it then, never against a copy taken before.
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
  async syncRunStates(): Promise<void> {
    const asked = new Set(taskStore.getTasks().flatMap((task) => liveTaskSessions(task).map((link) => link.sessionId)));
    if (asked.size === 0) return;

    const active = await activeRoots([...asked]);
    const idled: { taskId: string; sessionId: string }[] = [];
    for (const task of taskStore.getTasks()) {
      for (const link of liveTaskSessions(task)) {
        const { sessionId } = link;
        // A session linked while the read was out has no answer in it yet.
        if (!asked.has(sessionId)) continue;
        const state = link.runState ?? (sessionId === task.sessionId ? task.runState : 'idle');
        if (!this.isOursToJudge(task.id, sessionId, state)) continue;

        const ocActive = active.has(sessionId);
        if (ocActive && state !== 'running') this.adoptRunning(task.id, sessionId);
        else if (!ocActive && state === 'running') idled.push({ taskId: task.id, sessionId });
      }
    }
    if (idled.length > 0) await this.adoptIdle(idled);
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

  /** Set idle now; publish once the finished sessions' final cost has been read. */
  private async adoptIdle(sessions: { taskId: string; sessionId: string }[]): Promise<void> {
    const updated = sessions
      .map(({ taskId, sessionId }) => taskStore.setSessionRunState(taskId, sessionId, 'idle'))
      .filter((task): task is BoardTask => !!task);
    if (updated.length === 0) return;
    await refreshCachedSessionsOffThread(sessions.map((item) => item.sessionId));
    for (const task of updated) this.publisher.status(taskStore.getTask(task.id) || task);
  }

  /**
   * Pull OpenCode's own transcript into the board task.
   *
   * `incremental` reads only what has arrived since the last pass; a full read
   * is what opening a task does, since the client may have nothing cached.
   */
  async resyncTask(
    taskId: string,
    { incremental = false }: { incremental?: boolean } = {}
  ): Promise<{ task: BoardTask; changed: TaskLogItem[] } | null> {
    const task = taskStore.getTask(taskId);
    if (!task) return null;

    const links = liveTaskSessions(task);
    const merged = await this.mergeIncomingLogs(taskId, links, incremental);
    if (!merged) return null;

    const sessionIds = links.map((link) => link.sessionId);
    if (sessionIds.length > 0) await refreshCachedSessionsOffThread(sessionIds);

    await this.reconcileLinkStates(taskId, links, sessionIds);

    const live = taskStore.getTask(taskId) || merged.task;
    return { task: live, changed: merged.changed };
  }

  /** Read each session's new transcript entries and fold them into the task. */
  private async mergeIncomingLogs(
    taskId: string,
    links: TaskSessionLink[],
    incremental: boolean
  ): Promise<{ task: BoardTask; changed: TaskLogItem[] } | null> {
    const incoming: TaskLogItem[] = [];
    for (const link of links) {
      const since = incremental ? (this.watermarks.get(link.sessionId) ?? 0) : 0;
      const history = await readOffThread('sessionHistory', link.sessionId, since);
      if (history.watermark) this.watermarks.set(link.sessionId, history.watermark);
      for (const log of history.logs) {
        incoming.push({ ...log, sessionId: link.sessionId });
      }
    }
    const task = taskStore.getTask(taskId);
    if (!task) return null;
    if (incoming.length === 0) return { task, changed: [] };
    return taskStore.mergeLogs(taskId, incoming);
  }

  /** Bring each session link's run state back in line with the database. */
  private async reconcileLinkStates(
    taskId: string,
    links: TaskSessionLink[],
    sessionIds: string[]
  ): Promise<void> {
    const active = sessionIds.length > 0 ? await activeRoots(sessionIds) : new Set<string>();
    const latest = taskStore.getTask(taskId);
    if (!latest) return;
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
  async refreshOwnedTranscripts(): Promise<void> {
    const owned = taskStore.getTasks()
      .filter((task) => liveTaskSessions(task).some((link) => {
        if (acpManager.isSessionTurnInFlight(link.sessionId)) return false;
        return isSessionBusy(sessionRunState(task, link));
      }))
      .map((task) => task.id);
    for (const taskId of owned) {
      const result = await this.resyncTask(taskId, { incremental: true });
      if (result && result.changed.length > 0) {
        this.publisher.logBatch(taskId, result.changed, result.task);
      }
    }
  }

  /** Push the cards whose cost or context window moved since the last tick. */
  async refreshRunningSpend(): Promise<void> {
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
    await refreshCachedSessionsOffThread(ids);

    const dirtyTasks = new Set<string>();
    for (const id of ids) {
      if (spendFingerprint(id) === before.get(id)) continue;
      const taskId = taskBySession.get(id);
      if (taskId && taskStore.getTask(taskId)) dirtyTasks.add(taskId);
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

/** Which of these root sessions OpenCode is working in, read on the reader thread. */
export function activeRoots(sessionIds: string[]): Promise<Set<string>> {
  return readOffThread('activeRootSessionIds', sessionIds, Date.now(), BOARD_STARTED_AT);
}

/** What "the spend view of this session changed" means, as one comparable string. */
function spendFingerprint(sessionId: string): string {
  const live = cachedOpenCodeSession(sessionId);
  return `${live?.cost ?? ''}:${live?.contextTokens ?? ''}:${live?.contextLimit ?? ''}`;
}
