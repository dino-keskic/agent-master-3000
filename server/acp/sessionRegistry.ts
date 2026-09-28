import { TurnAttribution } from '../../shared/turns/attribution.js';
import { ConfigOption } from './schema.js';

/**
 * Everything the manager knows about one OpenCode session.
 *
 * This used to be a dozen parallel Maps and Sets keyed by session id, so
 * "what state is this session in" was a question you answered by grepping, and
 * every new lifecycle step risked clearing five of them and forgetting the
 * sixth. One record per session makes the whole state visible in one place.
 */
export interface SessionState {
  /** The board task this session is bound to, once the manager has bound it. */
  taskId?: string;
  /**
   * Config options as of the last `session/load` or `session/set_config_option`.
   * Undefined means this process has never loaded the session — a distinction
   * that matters, because an empty list is itself a legitimate answer.
   */
  configOptions?: ConfigOption[];
  /** Model/agent/effort to stamp on this session's messages. */
  attribution?: TurnAttribution;
  /** A `session/prompt` is on the wire for this session. */
  inFlight: boolean;
  /** Bumped by every stop and every new turn, so a late reply knows it is stale. */
  generation: number;
  /** The user stopped this session: late in-flight tool updates must not resurrect it. */
  cancelled: boolean;
}

function blank(): SessionState {
  return { inFlight: false, generation: 0, cancelled: false };
}

/**
 * Which sessions exist, who owns them, and what each one is doing.
 *
 * Deliberately free of I/O: it answers questions and records answers, and
 * every method here is one the manager used to inline against a raw Map.
 */
export class AcpSessionRegistry {
  private readonly sessions = new Map<string, SessionState>();
  /** taskId -> its primary session: the one a plain follow-up targets. */
  private readonly primary = new Map<string, string>();
  /** taskId -> the sessions it is loading right now; its logs are accepted while idle. */
  private readonly importing = new Map<string, Set<string>>();
  /**
   * Sessions whose replayed history must not reach the transcript. Per session,
   * not per task: a fork's turn streaming while the main session reloads is
   * live, and dropping it is a reply that never shows up.
   */
  private readonly replaySuppressed = new Set<string>();

  private mutable(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId);
    if (!state) {
      state = blank();
      this.sessions.set(sessionId, state);
    }
    return state;
  }

  // --- binding ---

  bind(sessionId: string, taskId: string): void {
    this.mutable(sessionId).taskId = taskId;
  }

  /** Forget who owns this session, keeping everything else known about it. */
  unbind(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.taskId = undefined;
  }

  taskOf(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.taskId;
  }

  /** Every bound session, as `[sessionId, taskId]` pairs. */
  boundSessions(): [string, string][] {
    const pairs: [string, string][] = [];
    for (const [sessionId, state] of this.sessions) {
      if (state.taskId) pairs.push([sessionId, state.taskId]);
    }
    return pairs;
  }

  sessionsOfTask(taskId: string): string[] {
    return this.boundSessions()
      .filter(([, ownerId]) => ownerId === taskId)
      .map(([sessionId]) => sessionId);
  }

  // --- the task's primary session ---

  primaryOf(taskId: string): string | undefined {
    return this.primary.get(taskId);
  }

  setPrimary(taskId: string, sessionId: string): void {
    this.primary.set(taskId, sessionId);
  }

  clearPrimary(taskId: string): void {
    this.primary.delete(taskId);
  }

  // --- configuration ---

  /** Undefined until the session has been loaded — not the same as `[]`. */
  configOptions(sessionId: string): ConfigOption[] | undefined {
    return this.sessions.get(sessionId)?.configOptions;
  }

  isLoaded(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.configOptions !== undefined;
  }

  setConfigOptions(sessionId: string, options: ConfigOption[]): void {
    this.mutable(sessionId).configOptions = options;
  }

  attribution(sessionId: string): TurnAttribution | undefined {
    return this.sessions.get(sessionId)?.attribution;
  }

  setAttribution(sessionId: string, attribution: TurnAttribution): void {
    this.mutable(sessionId).attribution = attribution;
  }

  // --- turns ---

  isInFlight(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.inFlight === true;
  }

  markInFlight(sessionId: string): void {
    this.mutable(sessionId).inFlight = true;
  }

  clearInFlight(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.inFlight = false;
  }

  inFlightCount(): number {
    let count = 0;
    for (const state of this.sessions.values()) {
      if (state.inFlight) count += 1;
    }
    return count;
  }

  inFlightSessions(): string[] {
    const ids: string[] = [];
    for (const [sessionId, state] of this.sessions) {
      if (state.inFlight) ids.push(sessionId);
    }
    return ids;
  }

  /** Claims the next turn for this session and returns its generation number. */
  nextGeneration(sessionId: string): number {
    const state = this.mutable(sessionId);
    state.generation += 1;
    return state.generation;
  }

  /** False once a stop or a newer turn has superseded `generation`. */
  isCurrentGeneration(sessionId: string, generation: number): boolean {
    return (this.sessions.get(sessionId)?.generation ?? 0) === generation;
  }

  isCancelled(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.cancelled === true;
  }

  markCancelled(sessionId: string): void {
    this.mutable(sessionId).cancelled = true;
  }

  clearCancelled(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.cancelled = false;
  }

  // --- import ---

  beginImport(taskId: string, sessionId: string, replayLogs: boolean): void {
    let loading = this.importing.get(taskId);
    if (!loading) {
      loading = new Set();
      this.importing.set(taskId, loading);
    }
    loading.add(sessionId);
    if (!replayLogs) this.replaySuppressed.add(sessionId);
  }

  endImport(taskId: string, sessionId: string): void {
    const loading = this.importing.get(taskId);
    loading?.delete(sessionId);
    if (loading?.size === 0) this.importing.delete(taskId);
    this.replaySuppressed.delete(sessionId);
  }

  isImporting(taskId: string): boolean {
    return this.importing.has(taskId);
  }

  replaysSuppressed(sessionId: string): boolean {
    return this.replaySuppressed.has(sessionId);
  }

  /** Whether any load is hiding its replay — the cheap check before a DB walk. */
  anyReplaySuppressed(): boolean {
    return this.replaySuppressed.size > 0;
  }

  /** A closed task has no replay left to suppress. */
  forgetTask(taskId: string): void {
    for (const sessionId of this.importing.get(taskId) ?? []) this.replaySuppressed.delete(sessionId);
  }

  // --- lifecycle ---

  /**
   * Drop what ties a session to this process, keeping what a late reply still
   * needs to judge itself by: its generation, and whether it was cancelled.
   */
  forgetSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.taskId = undefined;
    state.configOptions = undefined;
    state.attribution = undefined;
    state.inFlight = false;
  }

  /**
   * The agent process is gone, so every binding and loaded session went with
   * it. Generations and cancellations survive: the promises from before the
   * exit are still about to reject, and they judge themselves by both.
   */
  resetBindings(): void {
    for (const sessionId of this.sessions.keys()) this.forgetSession(sessionId);
    this.primary.clear();
  }
}
