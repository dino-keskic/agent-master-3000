import { AcpSessionSummary } from '../../shared/sessions/types.js';
import { BoardTask, PendingRequest, PermissionAnswer, PermissionMode } from '../../shared/types.js';
import {
  elicitationParamsSchema,
  JsonRpcId,
  parseSessionUpdate,
  requestPermissionParamsSchema
} from './schema.js';
import { killAgentProcesses, ProcessKillSpec } from './agentProcesses.js';
import { ApprovalDesk } from './approvals.js';
import { AcpEvent, AcpEventCallback } from './events.js';
import { AcpConfigOptionsResult, SessionConfigurator } from './sessionConfig.js';
import { AcpSessionRegistry } from './sessionRegistry.js';
import { ImportSessionOptions, ImportedSessionConfig, SessionLifecycle } from './sessions.js';
import { TranscriptStream } from './transcript.js';
import { AcpTransport } from './transport.js';
import { StartTurnOptions, TurnRunner } from './turns.js';

export type { AcpEvent, AcpEventCallback } from './events.js';
export type { AcpConfigOptionsResult } from './sessionConfig.js';
export type { ImportSessionOptions, ImportedSessionConfig } from './sessions.js';
export type { StartTurnOptions } from './turns.js';
export { setConfigStampSource, setToolPolicySource } from './transport.js';

/** Whether the agent's lists reflect OpenCode's config files as they are now. */
export type ConfigFreshness = 'current' | 'restarted' | 'stale';

/**
 * The least time between two restarts the board makes on its own. A config
 * file being saved over and over (an editor's autosave, a script) must not
 * keep killing the agent.
 */
const AUTO_RESTART_GAP_MS = 30_000;
/** How long a board load waits for the old agent to exit before reading from the new one. */
const RESTART_WAIT_MS = 5_000;

/**
 * The board's side of the Agent Client Protocol.
 *
 * Each piece owns one concern: the child process and JSON-RPC wire
 * (`AcpTransport`), what is known about each session (`AcpSessionRegistry`),
 * requests the agent is blocked on (`ApprovalDesk`), the update stream
 * (`TranscriptStream`), model/agent settings (`SessionConfigurator`), session
 * lifecycle (`SessionLifecycle`) and running turns (`TurnRunner`).
 *
 * What is left here is the wiring, and the one job that needs all of them at
 * once: routing what the agent sends to whoever should handle it.
 */
export class AcpManager {
  private readonly registry = new AcpSessionRegistry();
  private readonly transport: AcpTransport;
  private readonly approvals: ApprovalDesk;
  private readonly transcript: TranscriptStream;
  private readonly config: SessionConfigurator;
  private readonly sessions: SessionLifecycle;
  private readonly turns: TurnRunner;
  private eventCallback: AcpEventCallback | null = null;
  private folderResolver: ((taskId: string, sessionId: string) => string | undefined) | null = null;
  private lastConfigRestart = 0;
  private configRefresh: Promise<ConfigFreshness> | null = null;

  constructor() {
    const emit = (taskId: string, event: AcpEvent) => this.emit(taskId, event);
    this.transport = new AcpTransport({
      onRequest: (id, method, params) => this.onAgentRequest(id, method, params),
      onNotification: (method, params) => this.onAgentNotification(method, params),
      onExit: () => {
        this.registry.resetBindings();
        this.config.reset();
        // The ids every parked request is holding open died with the process.
        this.approvals.dropAll();
      }
    });
    this.approvals = new ApprovalDesk({
      respond: (id, result) => this.transport.respond(id, result),
      emit,
      folderFor: (taskId, sessionId) => this.folderResolver?.(taskId, sessionId),
      knownToolCall: (taskId, toolCallId) => this.transcript.knownToolCall(taskId, toolCallId)
    });
    this.transcript = new TranscriptStream(this.registry);
    this.config = new SessionConfigurator(this.transport, this.registry, emit);
    this.sessions = new SessionLifecycle(
      this.transport,
      this.registry,
      this.approvals,
      this.transcript,
      this.config,
      emit
    );
    this.turns = new TurnRunner(this.transport, this.registry, this.config, this.sessions, emit);
  }

  public setEventCallback(callback: AcpEventCallback): void {
    this.eventCallback = callback;
  }

  /** How the manager learns which folder the board runs a session in. */
  public setFolderResolver(resolver: (taskId: string, sessionId: string) => string | undefined): void {
    this.folderResolver = resolver;
  }

  private emit(taskId: string, event: AcpEvent): void {
    this.eventCallback?.(taskId, event);
  }

  // --- process lifecycle ---

  /** True when settings hold a tool policy the running agent has not picked up. */
  public toolPolicyPending(): boolean {
    return this.transport.policyPending();
  }

  /** True when an OpenCode config file changed after the running agent read them. */
  public configPending(): boolean {
    return this.transport.configPending();
  }

  /** Resolves once the old process is gone; the next request starts the new one. */
  public restartAgent(): Promise<void> {
    return this.transport.restart();
  }

  /**
   * Make the agent read OpenCode's config again when a file changed since it
   * started — the only way a new provider or agent reaches it. Never while
   * work is running: a restart drops every turn, so then the lists are
   * reported `stale` and the user decides. Loads arriving together share one
   * restart.
   */
  public refreshConfig(busy: () => boolean): Promise<ConfigFreshness> {
    if (this.configRefresh) return this.configRefresh;
    if (!this.transport.configPending()) return Promise.resolve('current');
    const working = busy() || this.registry.inFlightCount() > 0;
    if (working || Date.now() - this.lastConfigRestart < AUTO_RESTART_GAP_MS) return Promise.resolve('stale');

    this.lastConfigRestart = Date.now();
    console.log('[ACP] OpenCode config changed since the agent started; restarting it to read the new config.');
    const waited = new Promise<void>((resolve) => setTimeout(resolve, RESTART_WAIT_MS).unref());
    this.configRefresh = Promise.race([this.transport.restart(), waited])
      .then((): ConfigFreshness => 'restarted')
      .finally(() => { this.configRefresh = null; });
    return this.configRefresh;
  }

  public destroy(): void {
    this.transport.destroy();
  }

  public agentPid(): number | undefined {
    return this.transport.pid();
  }

  // --- inbound from the agent ---

  private onAgentNotification(method: string, params: unknown): void {
    if (!method.startsWith('session/')) return;
    const { sessionId, parsed } = parseSessionUpdate(params);
    const taskId = sessionId ? this.sessions.taskForSession(sessionId) : undefined;
    if (!taskId || (sessionId && this.sessions.isSuppressedReplay(sessionId))) return;
    const event = this.transcript.toEvent(taskId, parsed, sessionId);
    if (event) this.emit(taskId, event);
  }

  /**
   * Answer a request the agent is blocked on.
   *
   * `session/request_permission` and `elicitation/create` are the two that need
   * a human. Everything else we do not implement is refused explicitly, because
   * silence would hang the agent's turn for as long as the process lives.
   */
  private onAgentRequest(id: JsonRpcId, method: string, params: unknown): void {
    if (method === 'session/request_permission') {
      const parsed = requestPermissionParamsSchema.safeParse(params);
      if (!parsed.success) {
        console.warn('[ACP] Malformed session/request_permission:', parsed.error.message);
        this.transport.respondWithError(id, -32602, 'Malformed session/request_permission params');
        return;
      }
      this.approvals.onPermissionRequest(id, parsed.data, this.sessions.taskForSession(parsed.data.sessionId));
      return;
    }

    if (method === 'elicitation/create') {
      const parsed = elicitationParamsSchema.safeParse(params);
      if (!parsed.success) {
        this.transport.respondWithError(id, -32602, 'Malformed elicitation/create params');
        return;
      }
      // Elicitations are not addressed to a session, so they are attributed to
      // the turn that is running — and cancelled when that is ambiguous.
      this.approvals.onElicitation(
        id,
        parsed.data,
        this.sessions.soleInFlightTask(),
        this.sessions.soleInFlightSession()
      );
      return;
    }

    this.transport.respondWithError(id, -32601, `agent-master-3000 does not implement ${method}`);
  }

  // --- what the board asks about ---

  /** True when any session of this task is mid-turn. */
  public isTurnInFlight(taskId: string): boolean {
    return this.sessions.inFlightSessions(taskId).length > 0;
  }

  /** True when this specific session is mid-turn. */
  public isSessionTurnInFlight(sessionId: string): boolean {
    return this.registry.isInFlight(sessionId);
  }

  /** Sessions of this task with a turn in flight. */
  public inFlightSessions(taskId: string): string[] {
    return this.sessions.inFlightSessions(taskId);
  }

  public isImporting(taskId: string): boolean {
    return this.registry.isImporting(taskId);
  }

  /** What `modelId` offers, with the model list merged across `folders` (see `SessionConfigurator`). */
  public fetchConfigOptions(modelId?: string, folders?: readonly string[]): Promise<AcpConfigOptionsResult> {
    return this.config.fetchOptions(modelId, folders);
  }

  public listSessions(cwd?: string): Promise<AcpSessionSummary[]> {
    return this.sessions.listSessions(cwd);
  }

  // --- requests the agent is blocked on ---

  /** The server pushes the effective mode before each turn starts. */
  public setPermissionMode(taskId: string, mode: PermissionMode): void {
    this.approvals.setMode(taskId, mode);
  }

  public sessionForPendingRequest(requestId: string): string | undefined {
    return this.approvals.sessionForRequest(requestId);
  }

  public resolvePendingRequest(answer: PermissionAnswer): boolean {
    return this.approvals.resolve(answer);
  }

  public pendingRequestFor(taskId: string, sessionId?: string): PendingRequest | undefined {
    return this.approvals.requestFor(taskId, sessionId);
  }

  public cancelPendingRequests(taskId: string, sessionId?: string): void {
    this.approvals.cancelAll(taskId, sessionId);
  }

  // --- sessions ---

  public importSession(
    taskId: string,
    sessionId: string,
    cwd: string,
    options?: ImportSessionOptions
  ): Promise<ImportedSessionConfig> {
    return this.sessions.importSession(taskId, sessionId, cwd, options);
  }

  public bindExistingSession(task: BoardTask): Promise<void> {
    return this.sessions.bindExistingSession(task);
  }

  public releasePrimarySession(taskId: string): void {
    this.sessions.releasePrimarySession(taskId);
  }

  /** Close the ACP sessions. Only for delete or an explicit reset — not column moves. */
  public closeSession(taskId: string): Promise<void> {
    return this.sessions.closeSession(taskId);
  }

  // --- turns ---

  public startTaskExecution(task: BoardTask, promptMessage?: string, options?: StartTurnOptions): Promise<string> {
    return this.turns.start(task, promptMessage, options);
  }

  public compactSession(task: BoardTask, targetSessionId?: string): Promise<void> {
    return this.turns.compact(task, targetSessionId);
  }

  public cancelTurn(taskId: string, extraSessionIds: string[] = []): Promise<void> {
    return this.sessions.cancelTurn(taskId, extraSessionIds);
  }

  public cancelSessionTurn(taskId: string, sessionId: string): Promise<void> {
    return this.sessions.cancelSessionTurn(taskId, sessionId);
  }

  /** @deprecated Use cancelTurn (keep session) or closeSession (delete/reset). */
  public stopTaskExecution(taskId: string): Promise<void> {
    return this.sessions.cancelTurn(taskId);
  }

  /**
   * Kill leftover bash/shell processes this agent started for the stopped
   * work. `session/cancel` does not always reap them.
   */
  public async killBackgroundProcesses(spec: ProcessKillSpec): Promise<number> {
    const killed = await killAgentProcesses(this.agentPid(), spec);
    if (killed > 0) {
      console.log(`[ACP] Killed ${killed} leftover process(es) for stopped work`);
    }
    return killed;
  }
}

let instance: AcpManager | null = null;

export const getAcpManager = (): AcpManager => {
  if (!instance) instance = new AcpManager();
  return instance;
};

/**
 * The manager as callers use it: every call goes through `getAcpManager`, so
 * the agent process is spawned on first use rather than at import time.
 */
export const acpManager = {
  setEventCallback: (cb: AcpEventCallback) => getAcpManager().setEventCallback(cb),
  setFolderResolver: (resolver: (taskId: string, sessionId: string) => string | undefined) =>
    getAcpManager().setFolderResolver(resolver),
  fetchConfigOptions: (modelId?: string, folders?: readonly string[]) =>
    getAcpManager().fetchConfigOptions(modelId, folders),
  startTaskExecution: (task: BoardTask, promptMessage?: string, options?: StartTurnOptions) =>
    getAcpManager().startTaskExecution(task, promptMessage, options),
  compactSession: (task: BoardTask, sessionId?: string) => getAcpManager().compactSession(task, sessionId),
  cancelTurn: (taskId: string, extraSessionIds?: string[]) => getAcpManager().cancelTurn(taskId, extraSessionIds),
  cancelSessionTurn: (taskId: string, sessionId: string) => getAcpManager().cancelSessionTurn(taskId, sessionId),
  killBackgroundProcesses: (spec: ProcessKillSpec) => getAcpManager().killBackgroundProcesses(spec),
  agentPid: () => getAcpManager().agentPid(),
  toolPolicyPending: () => getAcpManager().toolPolicyPending(),
  configPending: () => getAcpManager().configPending(),
  refreshConfig: (busy: () => boolean) => getAcpManager().refreshConfig(busy),
  restartAgent: () => getAcpManager().restartAgent(),
  closeSession: (taskId: string) => getAcpManager().closeSession(taskId),
  stopTaskExecution: (taskId: string) => getAcpManager().cancelTurn(taskId),
  listSessions: (cwd?: string) => getAcpManager().listSessions(cwd),
  bindExistingSession: (task: BoardTask) => getAcpManager().bindExistingSession(task),
  releasePrimarySession: (taskId: string) => getAcpManager().releasePrimarySession(taskId),
  importSession: (taskId: string, sessionId: string, cwd: string, options?: ImportSessionOptions) =>
    getAcpManager().importSession(taskId, sessionId, cwd, options),
  isImporting: (taskId: string) => getAcpManager().isImporting(taskId),
  isTurnInFlight: (taskId: string) => getAcpManager().isTurnInFlight(taskId),
  isSessionTurnInFlight: (sessionId: string) => getAcpManager().isSessionTurnInFlight(sessionId),
  inFlightSessions: (taskId: string) => getAcpManager().inFlightSessions(taskId),
  setPermissionMode: (taskId: string, mode: PermissionMode) => getAcpManager().setPermissionMode(taskId, mode),
  resolvePendingRequest: (answer: PermissionAnswer) => getAcpManager().resolvePendingRequest(answer),
  sessionForPendingRequest: (requestId: string) => getAcpManager().sessionForPendingRequest(requestId),
  pendingRequestFor: (taskId: string, sessionId?: string) => getAcpManager().pendingRequestFor(taskId, sessionId),
  cancelPendingRequests: (taskId: string, sessionId?: string) => getAcpManager().cancelPendingRequests(taskId, sessionId),
  destroy: () => {
    if (instance) {
      instance.destroy();
      instance = null;
    }
  }
};
