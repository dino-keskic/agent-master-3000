import { BoardTask, PromptImage, QueuedTurn, SessionChoice } from '../../shared/types.js';
import { QueuedEntry, TurnQueue, sameTurn } from '../../shared/turns/queue.js';

/**
 * Everything the board remembers about turns that are queued, starting, or
 * deliberately stopped.
 *
 * Bookkeeping is keyed by *session*, not by task: a task's fork and its main
 * session run at the same time, so a single per-task slot would make one of
 * them wait on the other for no reason a user could see. A turn that has not
 * created its session yet has no id to key on, so it uses `new:<taskId>` until
 * the session exists — and `rekey` moves it once the id is known.
 *
 * Deliberately free of I/O: the orchestrator owns the side effects, this owns
 * the state, and the state is therefore testable on its own.
 */

export interface TurnOptions {
  reconfigure?: boolean;
  /** What the session this turn starts should run as, when the user picked. */
  chosen?: SessionChoice;
  /** Images dropped into the composer with this prompt. */
  images?: PromptImage[];
  columnId?: string;
  /** Run in this existing session (a fork, or a side chat being replied to). */
  sessionId?: string;
  /** Start a blank session even though the task already has one. */
  newSession?: boolean;
  /** Whether the session becomes the task's primary one. */
  primary?: boolean;
  isBtw?: boolean;
  title?: string;
  forkedFrom?: string;
  costAtFork?: number;
  cwd?: string;
  projectId?: string;
  /** Open the session and leave it waiting for the user's first prompt. */
  openOnly?: boolean;
}

export type PendingTurn = QueuedEntry<TurnOptions>;

/** The queue key for a turn, whether or not its session exists yet. */
export function turnKey(taskId: string, sessionId?: string): string {
  return sessionId || `new:${taskId}`;
}

/** The session a turn will land in, when that is already known. */
export function turnTargetSession(task: BoardTask, options?: TurnOptions): string | undefined {
  if (options?.sessionId) return options.sessionId;
  if (options?.newSession) return undefined;
  return task.sessionId;
}

export class TurnRegistry {
  private readonly queue = new TurnQueue<TurnOptions>();

  /** Keys whose turn is between "we decided to start" and "the agent has it". */
  private readonly starting = new Set<string>();

  /** What each in-flight turn is carrying, so a re-send is not queued as a follow-up. */
  private readonly inFlight = new Map<string, { prompt?: string; images?: PromptImage[] }>();

  /**
   * Sessions the user explicitly stopped. OpenCode's DB often keeps bash parts
   * `running` after a cancel, and a 20s grace was not enough — the next poll
   * (or opening the drawer) flipped the card back to in progress. Stays set
   * until this process starts a new turn in that session.
   */
  private readonly stopped = new Set<string>();

  // --- queue ---------------------------------------------------------------

  /**
   * Append a follow-up. `false` means it was suppressed as a duplicate of
   * something already waiting.
   */
  enqueue(key: string, input: { taskId: string; prompt?: string; sessionId?: string; images?: PromptImage[]; options?: TurnOptions }): boolean {
    return this.queue.enqueue(key, input) !== undefined;
  }

  /** The oldest prompt waiting on a key, removed. */
  shift(key: string): PendingTurn | undefined {
    return this.queue.shift(key);
  }

  remove(id: string, taskId?: string): PendingTurn | undefined {
    return this.queue.remove(id, taskId);
  }

  queuedForTask(taskId: string): QueuedTurn[] {
    return this.queue.forTask(taskId);
  }

  /** Drop everything waiting on a key — the user stopped that turn. */
  clear(key: string): number {
    return this.queue.clear(key);
  }

  /** Drop every queue belonging to a task — the task itself is gone. */
  clearTask(taskId: string): number {
    return this.queue.clearTask(taskId);
  }

  // --- in-flight -----------------------------------------------------------

  /** True when the running turn under `key` is already carrying this prompt. */
  isAlreadyRunning(key: string, prompt?: string, images?: PromptImage[]): boolean {
    const running = this.inFlight.get(key);
    return !!running && sameTurn({ prompt, images }, running);
  }

  isStarting(key: string): boolean {
    return this.starting.has(key);
  }

  beginStart(key: string, prompt?: string, images?: PromptImage[]): void {
    this.starting.add(key);
    this.inFlight.set(key, { prompt, images });
  }

  endStart(key: string): void {
    this.starting.delete(key);
  }

  clearInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  /**
   * Carry a turn's bookkeeping onto the session it turned out to create, so a
   * follow-up sent during startup is not stranded under `new:<taskId>`.
   */
  rekey(fromKey: string, toKey: string, sessionId: string): void {
    if (fromKey === toKey) return;
    const carried = this.inFlight.get(fromKey);
    this.inFlight.delete(fromKey);
    if (carried) this.inFlight.set(toKey, carried);
    this.queue.move(fromKey, toKey, sessionId);
  }

  // --- stopped sessions ----------------------------------------------------

  markStopped(sessionIds: Iterable<string>): void {
    for (const sessionId of sessionIds) {
      if (sessionId) this.stopped.add(sessionId);
    }
  }

  isStopped(sessionId: string | undefined): boolean {
    return !!sessionId && this.stopped.has(sessionId);
  }

  clearStopped(sessionId: string | undefined): void {
    if (sessionId) this.stopped.delete(sessionId);
  }
}
