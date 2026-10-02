import { BoardTask } from '../../shared/types.js';
import { processKillSpec } from '../../shared/agent/backgroundTasks.js';
import { deriveTaskTitle } from '../../shared/format.js';
import { isSessionBusy, listTaskSessions, liveTaskSessions, sessionRunState } from '../../shared/task/sessions.js';
import { acpManager } from '../acp/client.js';
import { attachChangeSummary, effectivePermissionMode, projectFor } from '../board/queries.js';
import { refreshCachedSessions } from '../opencode/hydrate.js';
import { listChildSessionIds } from '../opencode/subagents.js';
import { BoardPublisher } from '../live/publisher.js';
import { handOffMovedSession } from './sessionHandoff.js';
import { taskStore } from '../board/taskStore.js';
import { TurnOptions, TurnRegistry, turnKey, turnTargetSession } from './registry.js';
import { errorMessage } from '../../shared/errors.js';
import { turnInterrupted } from '../acp/events.js';

/**
 * Starting, queueing and compacting turns.
 *
 * The registry holds the state; this holds the side effects — the store writes,
 * the pushes to the board, and the calls into the ACP manager — so that the
 * ordering rules between them live in one readable place.
 */
export class TurnOrchestrator {
  constructor(
    private readonly turns: TurnRegistry,
    private readonly publisher: BoardPublisher
  ) {}

  /**
   * Run `prompt` in the task's target session, or queue it if that session is
   * already busy.
   */
  async start(taskId: string, prompt?: string, options?: TurnOptions): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) return;

    const targetSessionId = turnTargetSession(task, options);
    const key = turnKey(taskId, targetSessionId);

    if (this.isBusy(targetSessionId, key)) {
      this.queueBehind(key, taskId, prompt, targetSessionId, options);
      return;
    }

    this.beginTurn(taskId, task, key, prompt, targetSessionId, options);

    // Captured before the turn: `session_bound` reassigns `task.sessionId` as
    // soon as a new session exists, so this is the last chance to know which
    // session the new one is taking over from.
    const previousPrimary = task.sessionId;

    const { sessionId: startedSessionId, error } = await this.execute(taskId, task, prompt, targetSessionId, options, previousPrimary);
    this.turns.endStart(key);

    // A turn that created its session moved to a new key; carry the queue over
    // so a follow-up sent during startup is not stranded under `new:<taskId>`.
    if (startedSessionId && startedSessionId !== targetSessionId) {
      this.turns.rekey(key, turnKey(taskId, startedSessionId), startedSessionId);
    }

    if (error) this.failTurn(taskId, error, startedSessionId || targetSessionId, targetSessionId);
    // Nothing ran, so no turn end will come to settle it: a prompt typed while
    // the session was opening starts now, and otherwise it sits idle.
    else if (options?.openOnly && startedSessionId) this.drainOrIdle(taskId, startedSessionId);
  }

  private isBusy(targetSessionId: string | undefined, key: string): boolean {
    return (!!targetSessionId && acpManager.isSessionTurnInFlight(targetSessionId)) || this.turns.isStarting(key);
  }

  /** Hold a prompt behind the turn already running under `key`. */
  private queueBehind(
    key: string,
    taskId: string,
    prompt: string | undefined,
    targetSessionId: string | undefined,
    options?: TurnOptions
  ): void {
    // The prompt the running turn is already carrying is not a queue entry:
    // re-sending it is the same instruction twice, not a follow-up.
    if (this.turns.isAlreadyRunning(key, prompt, options?.images)) return;
    if (!this.turns.enqueue(key, { taskId, prompt, sessionId: targetSessionId, images: options?.images, options })) return;

    const running = this.markRunning(taskId, targetSessionId);
    // A snapshot has to go out either way: the queue changed, and nothing else
    // is going to tell the board that the user's typing landed.
    if (running) this.publisher.status(running);
    else this.publisher.queueChanged(taskId);
  }

  /** Claim the turn slot and put the card into its running state. */
  private beginTurn(
    taskId: string,
    task: BoardTask,
    key: string,
    prompt: string | undefined,
    targetSessionId: string | undefined,
    options?: TurnOptions
  ): void {
    this.turns.beginStart(key, prompt, options?.images);
    this.turns.clearStopped(targetSessionId);
    // The manager answers permission requests on its own thread of control, so
    // it needs the effective mode before the turn can produce one.
    acpManager.setPermissionMode(taskId, effectivePermissionMode(task));
    if (options?.columnId) taskStore.setLastRunColumnId(taskId, options.columnId);

    const running = this.markRunning(taskId, targetSessionId);
    if (running) this.publisher.status(running);
  }

  /** Hand the turn to the agent, and record the session it landed in. */
  private async execute(
    taskId: string,
    task: BoardTask,
    prompt: string | undefined,
    targetSessionId: string | undefined,
    options: TurnOptions | undefined,
    previousPrimary: string | undefined
  ): Promise<{ sessionId?: string; error?: string }> {
    try {
      let latest = taskStore.getTask(taskId) || task;
      // A session moved to another folder continues in a copy filed there.
      const handedOff = handOffMovedSession(latest, targetSessionId);
      if (handedOff) {
        latest = taskStore.getTask(taskId) || latest;
        options = { ...options, sessionId: handedOff };
        targetSessionId = handedOff;
        this.publisher.refresh(taskId);
      }
      const sessionId = await acpManager.startTaskExecution(latest, prompt, {
        ...options,
        cwd: options?.cwd || (targetSessionId
          ? listTaskSessions(latest).find((link) => link.sessionId === targetSessionId)?.cwd
          : undefined)
      });

      this.linkStartedSession(taskId, sessionId, prompt, options, previousPrimary);
      taskStore.updateTask(taskId, { error: undefined });
      this.turns.clearStopped(sessionId);
      // The turn is running in the session the manager actually used, which is
      // only known now — a brand-new session had no id to mark 'running' earlier.
      if (!options?.openOnly) taskStore.setSessionRunState(taskId, sessionId, 'running');
      this.publisher.refresh(taskId);
      return { sessionId };
    } catch (e) {
      console.error(`[Server] Error starting ACP execution for ${taskId}:`, e);
      return { error: errorMessage(e) ?? String(e) };
    }
  }

  /** A start that threw: drain the queue behind it, or surface the failure. */
  private failTurn(
    taskId: string,
    error: string,
    failedSessionId: string | undefined,
    targetSessionId: string | undefined
  ): void {
    const queued = this.turns.shift(turnKey(taskId, failedSessionId));
    if (queued) {
      void this.start(taskId, queued.prompt, queued.options);
      return;
    }
    if (targetSessionId) taskStore.setSessionRunState(taskId, targetSessionId, 'error');
    else taskStore.setRunState(taskId, 'error');
    taskStore.updateTask(taskId, { error });
    const finalTask = taskStore.getTask(taskId);
    if (finalTask) this.publisher.failed(taskId, error, finalTask);
  }

  private markRunning(taskId: string, sessionId: string | undefined): BoardTask | null {
    return sessionId
      ? taskStore.setSessionRunState(taskId, sessionId, 'running')
      : taskStore.setRunState(taskId, 'running');
  }

  /**
   * Record the session a turn just created or reused, so the board knows what
   * it is, where it came from, and whether follow-ups should go there.
   */
  private linkStartedSession(
    taskId: string,
    sessionId: string,
    prompt: string | undefined,
    options?: TurnOptions,
    previousPrimary?: string
  ): void {
    const task = taskStore.getTask(taskId);
    if (!task) return;

    if (options?.isBtw) {
      taskStore.linkSession(taskId, {
        sessionId,
        title: options.title || (prompt ? deriveTaskTitle(prompt) : 'Side Chat') || 'Side Chat',
        kind: 'btw',
        origin: 'fork',
        forkedFrom: options.forkedFrom,
        costAtFork: options.costAtFork,
        chosen: options.chosen,
        prompt,
        primary: false
      });
      return;
    }

    if (options?.newSession || !task.sessionId) {
      const project = projectFor(options?.projectId, options?.cwd);
      taskStore.linkSession(taskId, {
        sessionId,
        title: options?.title || task.title,
        kind: 'main',
        // Only a deliberate restart is 'new'. A first session, or the fresh one
        // a stage transition demands, is the task's main line rather than a
        // choice to abandon an earlier context.
        origin: options?.newSession ? 'new' : 'initial',
        chosen: options?.chosen,
        prompt,
        cwd: options?.cwd,
        projectId: project?.id || options?.projectId,
        projectName: project?.name,
        primary: true,
        supersedes: previousPrimary
      });
      return;
    }

    if (options?.sessionId && options.sessionId !== task.sessionId) {
      taskStore.switchActiveSession(taskId, options.sessionId);
    }
  }

  // --- busy checks ---------------------------------------------------------

  /** A compact is a turn, so it must not race one the board already owns. */
  isTurnBusy(taskId: string, sessionId?: string): boolean {
    if (sessionId) {
      return acpManager.isSessionTurnInFlight(sessionId) || this.turns.isStarting(turnKey(taskId, sessionId));
    }
    return acpManager.isTurnInFlight(taskId) || this.turns.isStarting(turnKey(taskId));
  }

  /**
   * A drop must not barge in on work that is already happening — including an
   * imported OpenCode session the board did not itself start.
   */
  hasBusyWork(task: BoardTask): boolean {
    for (const link of liveTaskSessions(task)) {
      if (isSessionBusy(sessionRunState(task, link))) return true;
      if (this.isTurnBusy(task.id, link.sessionId)) return true;
    }
    return this.isTurnBusy(task.id);
  }

  /** Every task with work running — what a restart of the agent would cut off. */
  busyTasks(): BoardTask[] {
    return taskStore.getTasks().filter((task) => this.hasBusyWork(task));
  }

  // --- compaction ----------------------------------------------------------

  /**
   * Compact one session and resolve when that turn is over, so a column's
   * compact-on-enter can sequence its own prompt after it.
   *
   * The manager claims the in-flight slot synchronously and drives the
   * finishing state through the same status_change path as a prompt turn — so
   * `beginStart` is deliberately *not* used here: it is only ever held while no
   * turn is in flight yet, and holding it across status_change would bounce a
   * queued turn.
   */
  async compact(taskId: string, sessionId?: string): Promise<void> {
    const task = taskStore.getTask(taskId);
    if (!task) throw new Error('Task not found');
    const target = sessionId || task.sessionId;
    if (!target) throw new Error('This task has no OpenCode session to compact yet');

    // Before the call, not after: the manager emits its opening log
    // synchronously when the session is already bound, and the log gate drops
    // it unless the session is already 'running'.
    this.turns.clearStopped(target);
    const running = taskStore.setSessionRunState(taskId, target, 'running');
    if (running) this.publisher.status(running);
    await acpManager.compactSession(task, target);
  }

  // --- stopping ------------------------------------------------------------

  /**
   * Stop the turn in one session, leaving the task's other sessions running.
   *
   * Stopping a session drops what was waiting behind it too: the user stopped
   * this line of work, not just the prompt that happened to be running.
   */
  async stopSession(task: BoardTask, sessionId: string): Promise<BoardTask> {
    const taskId = task.id;
    const key = turnKey(taskId, sessionId);
    this.turns.clear(key);
    this.turns.clearInFlight(key);

    const affected = [sessionId, ...listChildSessionIds(sessionId)];
    this.turns.markStopped(affected);
    taskStore.setSessionPendingRequest(taskId, sessionId, undefined);
    await acpManager.cancelSessionTurn(taskId, sessionId);
    await acpManager.killBackgroundProcesses(processKillSpec(task, affected));

    const failed = taskStore.failLiveTools(taskId, affected);
    const stopped = taskStore.setSessionRunState(taskId, sessionId, 'idle') || task;
    const live = this.publisher.status(stopped);
    if (failed && failed.changed.length > 0) this.publisher.logBatch(taskId, failed.changed, stopped);
    return live;
  }

  /**
   * Send a queued prompt now: move it to the front of its session's queue and
   * cut off the turn it is waiting on. False when it is no longer queued.
   *
   * The prompt is not started here. A cancelled turn still answers its
   * `session/prompt`, as superseded, and that turn end drains the queue through
   * `drainOrIdle` like any other — starting it here as well would leave the
   * late answer free to drain the next one too, or idle the session under it.
   * The rest of the queue stays where it was, behind it, and nothing running in
   * the background is killed: this replaces a turn, it does not stop the work.
   */
  async sendQueuedNow(task: BoardTask, queuedId: string): Promise<boolean> {
    const taskId = task.id;
    const promoted = this.turns.promote(queuedId, taskId);
    if (!promoted) return false;
    const { key, entry } = promoted;
    const sessionId = entry.sessionId;

    if (sessionId && acpManager.isSessionTurnInFlight(sessionId)) {
      const affected = [sessionId, ...listChildSessionIds(sessionId)];
      this.publisher.log(taskId, turnInterrupted(sessionId));
      taskStore.setSessionPendingRequest(taskId, sessionId, undefined);
      await acpManager.cancelSessionTurn(taskId, sessionId);
      const failed = taskStore.failLiveTools(taskId, affected);
      if (failed && failed.changed.length > 0) this.publisher.logBatch(taskId, failed.changed, failed.task);
    } else if (!this.turns.isStarting(key)) {
      // The turn it was waiting on ended meanwhile, and nothing has drained it.
      const next = this.turns.shift(key);
      if (next) void this.start(taskId, next.prompt, next.options);
    }
    // Still starting: the turn has no agent call to cancel yet, and the prompt
    // goes as soon as it ends — first, now.
    this.publisher.queueChanged(taskId);
    return true;
  }

  /**
   * Stop everything the card has running — main session, forks, and their
   * subagents — so every per-session key has to be cleared, not just the one
   * the task is pointing at.
   */
  async stopTask(task: BoardTask): Promise<BoardTask> {
    const taskId = task.id;
    const sessionIds = liveTaskSessions(task).map((link) => link.sessionId);
    const affected = [...sessionIds, ...sessionIds.flatMap((sessionId) => listChildSessionIds(sessionId))];

    for (const key of [turnKey(taskId), ...sessionIds.map((sessionId) => turnKey(taskId, sessionId))]) {
      this.turns.clear(key);
      this.turns.clearInFlight(key);
    }
    this.turns.markStopped(affected);
    taskStore.clearPendingRequests(taskId);
    await acpManager.cancelTurn(taskId, affected);
    await acpManager.killBackgroundProcesses(processKillSpec(task, affected));

    const failed = taskStore.failLiveTools(taskId, affected);
    let stopped = task;
    for (const sessionId of sessionIds) {
      stopped = taskStore.setSessionRunState(taskId, sessionId, 'idle') || stopped;
    }
    stopped = taskStore.setRunState(taskId, 'idle') || stopped;
    const live = this.publisher.status(stopped);
    if (failed && failed.changed.length > 0) this.publisher.logBatch(taskId, failed.changed, stopped);
    return live;
  }

  // --- turn completion -----------------------------------------------------

  /**
   * A turn ended. Start the next prompt waiting on that session if there is
   * one, otherwise put the session back to idle.
   *
   * @returns true when a queued turn took over, so the caller stops here.
   */
  drainOrIdle(taskId: string, sessionId: string | undefined): boolean {
    const key = turnKey(taskId, sessionId);
    this.turns.clearInFlight(key);
    // Only the front of the queue starts here; the rest stay waiting on it, and
    // drain one per completed turn.
    const queued = this.turns.shift(key);
    if (queued) {
      void this.start(taskId, queued.prompt, queued.options);
      return true;
    }
    taskStore.setSessionPendingRequest(taskId, sessionId, undefined);
    const updated = sessionId
      ? taskStore.setSessionRunState(taskId, sessionId, 'idle')
      : taskStore.setRunState(taskId, 'idle');
    if (sessionId) refreshCachedSessions([sessionId]);
    // A turn can end with a tool call that never reported — the agent died
    // mid-call, or the result was lost. Nothing will finish it now, and left
    // alone it counts as a background task for as long as the board remembers
    // the task. Stop already does this; so does the end of a turn.
    const swept = taskStore.sweepStaleTools(taskId);
    const withDiff = attachChangeSummary(taskId) || swept?.task || updated;
    if (withDiff) this.publisher.status(withDiff);
    if (swept && swept.changed.length > 0) this.publisher.logBatch(taskId, swept.changed, swept.task);
    return false;
  }
}
