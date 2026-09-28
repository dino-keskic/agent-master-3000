import { AcpSessionSummary } from '../../shared/sessions/types.js';
import { BoardTask } from '../../shared/types.js';
import { ConfigOption, findOption, sessionListSchema, sessionResultSchema } from './schema.js';
import { boardMcpServer } from '../mcp/boardMcp.js';
import { getOpenCodeSession } from '../opencode/sessionList.js';
import { findRootSessionId, listChildSessionIds } from '../opencode/subagents.js';
import { ApprovalDesk } from './approvals.js';
import { AcpEvent, sessionBound } from './events.js';
import { SessionConfigurator } from './sessionConfig.js';
import { AcpSessionRegistry } from './sessionRegistry.js';
import { TranscriptStream } from './transcript.js';
import { AcpTransport } from './transport.js';

const IMPORT_TIMEOUT_MS = 120000;
const IMPORT_SETTLE_MS = 1500;
/** Long enough for a subagent to close, short enough not to hold up a stop. */
const CLOSE_CHILD_TIMEOUT_MS = 3000;

export interface ImportSessionOptions {
  replayLogs?: boolean;
  primary?: boolean;
}

/** What a session/load told us the session is currently configured as. */
export interface ImportedSessionConfig {
  model?: string;
  agent?: string;
  effortLevel?: string;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function importedConfig(configOptions: ConfigOption[]): ImportedSessionConfig {
  const find = (id: string) => findOption(configOptions, id)?.currentValue;
  return { model: find('model'), agent: find('mode'), effortLevel: find('effort') };
}

/** The folder OpenCode created the session in — the one its tools run in. */
function openCodeDirectory(sessionId: string): string | undefined {
  return getOpenCodeSession(sessionId)?.cwd || undefined;
}

/**
 * Which OpenCode session belongs to which task, and how sessions begin and end.
 *
 * Everything here is about the session as a thing that exists — attaching one
 * to a task, working out which task an update came from, stopping a turn,
 * closing the session for good. What is *said* during a session is the turn
 * runner's business, not this one's.
 */
export class SessionLifecycle {
  /**
   * `session/load`s in flight, by session. A load can take a while on a long
   * session, and a follow-up sent meanwhile would otherwise start a second one
   * whose replay lands on top of the reply it is waiting for.
   */
  private readonly loads = new Map<string, Promise<unknown>>();

  constructor(
    private readonly transport: AcpTransport,
    private readonly registry: AcpSessionRegistry,
    private readonly approvals: ApprovalDesk,
    private readonly transcript: TranscriptStream,
    private readonly config: SessionConfigurator,
    private readonly emit: (taskId: string, event: AcpEvent) => void
  ) {}

  // --- attributing what the agent sends ---

  /** Which task an update belongs to, including updates from its subagents. */
  /**
   * Is this update part of a history replay its loader asked not to see? A
   * subagent's replay counts against the session it hangs off.
   */
  isSuppressedReplay(sessionId: string): boolean {
    if (!this.registry.anyReplaySuppressed()) return false;
    if (this.registry.replaysSuppressed(sessionId)) return true;
    const rootId = findRootSessionId(sessionId);
    return !!rootId && rootId !== sessionId && this.registry.replaysSuppressed(rootId);
  }

  taskForSession(sessionId: string): string | undefined {
    const bound = this.registry.taskOf(sessionId);
    if (bound) return bound;

    // A subagent of any session we have bound — forks included, which is why
    // this walks every binding rather than only the tasks' primary sessions.
    for (const [boundSessionId, boundTaskId] of this.registry.boundSessions()) {
      if (boundSessionId === sessionId) continue;
      if (listChildSessionIds(boundSessionId).includes(sessionId)) {
        this.registry.bind(sessionId, boundTaskId);
        return boundTaskId;
      }
    }

    const rootId = findRootSessionId(sessionId);
    const rootTask = rootId && rootId !== sessionId ? this.registry.taskOf(rootId) : undefined;
    if (rootTask) {
      this.registry.bind(sessionId, rootTask);
      return rootTask;
    }

    return this.soleInFlightTask();
  }

  /**
   * The task whose turn is running, when exactly one is. Elicitations arrive
   * without a session id, so this is the only way to attribute them; with
   * several turns in flight there is no honest answer and the caller cancels.
   */
  soleInFlightTask(): string | undefined {
    const tasks = new Set<string>();
    for (const sessionId of this.registry.inFlightSessions()) {
      const taskId = this.registry.taskOf(sessionId);
      if (taskId) tasks.add(taskId);
    }
    return tasks.size === 1 ? [...tasks][0] : undefined;
  }

  /** The session whose turn is running, when exactly one is. */
  soleInFlightSession(): string | undefined {
    const inFlight = this.registry.inFlightSessions();
    return inFlight.length === 1 ? inFlight[0] : undefined;
  }

  async listSessions(cwd?: string): Promise<AcpSessionSummary[]> {
    const res = await this.transport.request('session/list', cwd ? { cwd } : {});
    const parsed = sessionListSchema.safeParse(res);
    if (!parsed.success) return [];
    return parsed.data.sessions.map((session) => ({
      sessionId: session.sessionId,
      title: session.title || 'Untitled session',
      cwd: session.cwd || '',
      updatedAt: session.updatedAt || '',
      agent: session.agent
    }));
  }

  // --- binding sessions to tasks ---

  /**
   * Forget which session is a task's primary, without closing anything.
   *
   * A stage column that demands a fresh session clears `task.sessionId` in the
   * store, but the manager's own binding would still be pointing at the retired
   * session — and a turn prefers that binding, so the next one would silently
   * continue the very conversation the stage was meant to leave.
   */
  releasePrimarySession(taskId: string): void {
    this.registry.clearPrimary(taskId);
  }

  /** Bind an already-running OpenCode session so logs/stop work after a reload. */
  async bindExistingSession(task: BoardTask): Promise<void> {
    if (!task.sessionId) return;
    if (this.registry.primaryOf(task.id) === task.sessionId) return;
    if (this.registry.isInFlight(task.sessionId)) return;
    await this.importSession(task.id, task.sessionId, task.cwd || process.cwd(), { replayLogs: false });
  }

  /**
   * Attach an existing OpenCode session to a task.
   * replayLogs=true (import) streams history into the task; false (resume) just binds it.
   */
  async importSession(
    taskId: string,
    sessionId: string,
    cwd: string,
    options: ImportSessionOptions = {}
  ): Promise<ImportedSessionConfig> {
    // Join a load already under way rather than racing it; if that one
    // failed, fall through and try again.
    const pending = this.loads.get(sessionId);
    if (pending) {
      await pending.catch(() => undefined);
      if (this.registry.isLoaded(sessionId)) {
        if (options.primary !== false) this.registry.setPrimary(taskId, sessionId);
        this.registry.bind(sessionId, taskId);
        return importedConfig(this.registry.configOptions(sessionId) ?? []);
      }
    }
    const load = this.load(taskId, sessionId, cwd, options);
    this.loads.set(sessionId, load);
    try {
      return await load;
    } finally {
      if (this.loads.get(sessionId) === load) this.loads.delete(sessionId);
    }
  }

  private async load(
    taskId: string,
    sessionId: string,
    cwd: string,
    options: ImportSessionOptions
  ): Promise<ImportedSessionConfig> {
    const replayLogs = options.replayLogs !== false;
    // A fork is bound to the task but must not become the session that plain
    // follow-ups and column auto-runs target.
    const primary = options.primary !== false;
    const previousPrimary = this.registry.primaryOf(taskId);
    if (primary) this.registry.setPrimary(taskId, sessionId);
    this.registry.bind(sessionId, taskId);
    this.registry.beginImport(taskId, sessionId, replayLogs);

    try {
      // OpenCode runs a session's tools in the directory it was created in, and
      // ignores the cwd a load names. Permission replies are the exception: they
      // carry no session, so OpenCode routes them by the cwd given here. Load a
      // session anywhere else (a board move to a worktree) and every approval
      // lands in the wrong instance, is dropped, and the tool waits forever.
      const res = await this.transport.request(
        'session/load',
        { sessionId, cwd: openCodeDirectory(sessionId) || cwd, mcpServers: [boardMcpServer(taskId)] },
        IMPORT_TIMEOUT_MS
      );
      const configOptions = sessionResultSchema.parse(res).configOptions ?? [];
      this.registry.setConfigOptions(sessionId, configOptions);
      // Replayed history arrives as a burst of updates after the reply; give it
      // a moment to land so the caller sees a populated transcript.
      if (replayLogs) await delay(IMPORT_SETTLE_MS);

      this.config.rememberAttribution(sessionId, configOptions);
      this.emit(taskId, sessionBound(sessionId, primary));
      return importedConfig(configOptions);
    } catch (e) {
      if (primary) {
        if (previousPrimary) this.registry.setPrimary(taskId, previousPrimary);
        else this.registry.clearPrimary(taskId);
      }
      this.registry.unbind(sessionId);
      throw e;
    } finally {
      this.registry.endImport(taskId, sessionId);
    }
  }

  // --- stopping ---

  /**
   * Cancel every turn this task has in flight, keeping the sessions so a
   * follow-up continues the same conversations.
   */
  async cancelTurn(taskId: string, extraSessionIds: string[] = []): Promise<void> {
    const targets = new Set<string>([...this.inFlightSessions(taskId), ...extraSessionIds]);
    const primary = this.registry.primaryOf(taskId);
    if (primary) targets.add(primary);
    await this.cancelSessions(taskId, [...targets]);
  }

  /**
   * Cancel one session's turn and leave the task's other sessions running —
   * stopping a fork must not kill the main thread it was taken from.
   */
  async cancelSessionTurn(taskId: string, sessionId: string): Promise<void> {
    await this.cancelSessions(taskId, [sessionId], sessionId);
  }

  /**
   * Answer whatever a session was still blocked on when its turn ended, or is
   * somehow still blocked on as a new turn begins.
   *
   * A parked request outlives nothing: the moment `session/prompt` returns, the
   * agent has stopped waiting for the answer. But the desk shows one request per
   * session and hands the next one over only as each is answered, so a request
   * left behind by a finished turn becomes a head nobody can answer, and every
   * later request in that session queues behind it — the agent blocks on a read
   * outside its folder and the board never asks. That is the bug this exists to
   * prevent, and it survived process restarts because nothing ever cleared it.
   *
   * Scoped to the session, unless nothing else of the task is running: then its
   * subagents' requests (parked under session ids of their own) are dead too.
   */
  releaseParkedRequests(taskId: string, sessionId: string): void {
    const others = this.inFlightSessions(taskId).filter((id) => id !== sessionId);
    this.approvals.cancelAll(taskId, others.length > 0 ? sessionId : undefined);
  }

  /**
   * A turn is over: what it was still streaming can be let go. Scoped like
   * `releaseParkedRequests` — its subagents stream under session ids of their
   * own that never settle here, so they go when nothing of the task is left.
   */
  turnSettled(taskId: string, sessionId: string): void {
    if (this.inFlightSessions(taskId).some((id) => id !== sessionId)) this.transcript.forgetSession(sessionId);
    else this.transcript.forgetTask(taskId);
  }

  /** Sessions of this task with a turn in flight. */
  inFlightSessions(taskId: string): string[] {
    return this.registry.inFlightSessions().filter((sessionId) => this.registry.taskOf(sessionId) === taskId);
  }

  /**
   * `scopeToSession` narrows which parked requests get answered: unset means
   * "everything this task is blocked on", which is only right when the whole
   * task is being stopped.
   */
  private async cancelSessions(taskId: string, sessionIds: string[], scopeToSession?: string): Promise<void> {
    // Release anything the agent is blocked on first, or session/cancel can
    // deadlock against a request that is still waiting for an answer.
    this.approvals.cancelAll(taskId, scopeToSession);

    const requested = sessionIds.filter((id): id is string => !!id);
    const children = childrenOf(requested);
    const all = [...new Set([...requested, ...children])];
    if (all.length === 0) return;

    for (const sessionId of all) {
      this.registry.clearInFlight(sessionId);
      this.registry.markCancelled(sessionId);
      this.registry.nextGeneration(sessionId);
      this.transport.notify('session/cancel', { sessionId });
    }

    // Subagents are disposable; the sessions the user can see are not.
    await Promise.allSettled(children.map((sessionId) =>
      this.transport.request('session/close', { sessionId }, CLOSE_CHILD_TIMEOUT_MS).catch(() => null)
    ));
    console.log(`[ACP] Stopped ${taskId}: ${requested.length} session(s) + ${children.length} subagent(s)`);
  }

  /** Close the ACP sessions. Only for delete or an explicit reset — not column moves. */
  async closeSession(taskId: string): Promise<void> {
    this.approvals.cancelAll(taskId);
    this.approvals.clearMode(taskId);
    this.transcript.forgetTask(taskId);
    this.registry.forgetTask(taskId);

    // Every session bound to the task, not just its primary one — a deleted
    // task must not leave its forks running against a folder nobody watches.
    const owned = this.registry.sessionsOfTask(taskId);
    const primary = this.registry.primaryOf(taskId);
    if (primary && !owned.includes(primary)) owned.push(primary);
    if (owned.length === 0) return;

    const children = owned.flatMap((sessionId) => listChildSessionIds(sessionId));
    const sessionIds = [...new Set([...owned, ...children])];
    this.registry.clearPrimary(taskId);
    for (const sessionId of sessionIds) {
      this.registry.markCancelled(sessionId);
      this.registry.forgetSession(sessionId);
    }
    await Promise.allSettled(sessionIds.map((sessionId) =>
      this.transport.request('session/close', { sessionId }).catch(() => null)
    ));
    console.log(`[ACP] Closed ${owned.length} session(s) (+ ${children.length} child sessions) for task ${taskId}`);
  }
}

/** Subagent sessions spawned by any of `sessionIds`, excluding the roots themselves. */
function childrenOf(sessionIds: string[]): string[] {
  const children = new Set<string>();
  for (const sessionId of sessionIds) {
    for (const child of listChildSessionIds(sessionId)) {
      if (!sessionIds.includes(child)) children.add(child);
    }
  }
  return [...children];
}
