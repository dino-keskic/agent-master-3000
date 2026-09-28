import { newId } from '../ids.js';
import { sameImages } from '../composer/promptImages.js';
import { BoardTask, PromptImage, QueuedTurn } from '../types.js';

/**
 * Prompts the user typed while a turn was already running.
 *
 * Queues are keyed per *session*, not per task: a task's fork and its main
 * session run at the same time, so a prompt waits only on the turn it will
 * actually follow. Nothing here is persisted — a restart drops the in-flight
 * turns too, and a queue that outlived one would promise sends that are never
 * going to happen.
 */
export interface QueuedEntry<Options> extends QueuedTurn {
  taskId: string;
  /** Handed back to the caller verbatim when the entry drains. */
  options?: Options;
}

export interface QueueInput<Options> {
  taskId: string;
  prompt?: string;
  /** The session this turn will land in, when that is already known. */
  sessionId?: string;
  /** Images dropped with the prompt. Held here so the queue can show them. */
  images?: PromptImage[];
  options?: Options;
}

/** An absent prompt and an empty one are the same turn: a column run with none of its own. */
export function samePrompt(a?: string, b?: string): boolean {
  return (a || '') === (b || '');
}

/**
 * Whether two turns are the same instruction. Images count: the same sentence
 * about two different screenshots is two different things to ask, and an
 * image-only turn has no text to tell it apart by at all.
 */
export function sameTurn(
  a: { prompt?: string; images?: PromptImage[] },
  b: { prompt?: string; images?: PromptImage[] }
): boolean {
  return samePrompt(a.prompt, b.prompt) && sameImages(a.images, b.images);
}

/** What the client sees — the entry without the server's own bookkeeping. */
function publicTurn<Options>(entry: QueuedEntry<Options>): QueuedTurn {
  const turn: QueuedTurn = { id: entry.id, queuedAt: entry.queuedAt };
  if (entry.prompt !== undefined) turn.prompt = entry.prompt;
  if (entry.sessionId) turn.sessionId = entry.sessionId;
  if (entry.images?.length) turn.images = entry.images;
  return turn;
}

export class TurnQueue<Options = unknown> {
  private readonly byKey = new Map<string, QueuedEntry<Options>[]>();

  /**
   * Append to the back of a key's queue, unless the same prompt is already
   * waiting there — a double submit must not send the agent one instruction
   * twice. `undefined` means the prompt was suppressed as a duplicate.
   */
  enqueue(key: string, input: QueueInput<Options>): QueuedEntry<Options> | undefined {
    const queue = this.byKey.get(key);
    if (queue?.some((entry) => sameTurn(entry, input))) return undefined;

    const entry: QueuedEntry<Options> = { id: newId(), queuedAt: Date.now(), ...input };
    if (queue) queue.push(entry);
    else this.byKey.set(key, [entry]);
    return entry;
  }

  /** The oldest waiting prompt, removed from the queue. */
  shift(key: string): QueuedEntry<Options> | undefined {
    const queue = this.byKey.get(key);
    if (!queue) return undefined;
    const next = queue.shift();
    if (queue.length === 0) this.byKey.delete(key);
    return next;
  }

  /** Everything waiting under one key, oldest first. */
  list(key: string): QueuedTurn[] {
    return (this.byKey.get(key) || []).map(publicTurn);
  }

  /**
   * Every prompt waiting on any of a task's sessions, oldest first — what the
   * card counts, since it says "2 queued" without naming a session.
   */
  forTask(taskId: string): QueuedTurn[] {
    const turns: QueuedTurn[] = [];
    for (const queue of this.byKey.values()) {
      for (const entry of queue) {
        if (entry.taskId === taskId) turns.push(publicTurn(entry));
      }
    }
    // Sorting is stable, so entries queued within the same millisecond keep the
    // order they were appended in.
    return turns.sort((a, b) => a.queuedAt - b.queuedAt);
  }

  /** One waiting prompt, dropped. `taskId` guards against an id from another task. */
  remove(id: string, taskId?: string): QueuedEntry<Options> | undefined {
    for (const [key, queue] of this.byKey) {
      const index = queue.findIndex((entry) => entry.id === id);
      const found = index < 0 ? undefined : queue[index];
      if (!found) continue;
      if (taskId && found.taskId !== taskId) return undefined;
      queue.splice(index, 1);
      if (queue.length === 0) this.byKey.delete(key);
      return found;
    }
    return undefined;
  }

  /**
   * Re-key a queue onto the session its turn turned out to create, stamping
   * that session on the entries. A turn with no session yet is keyed on a
   * placeholder, and anything typed during its startup would be stranded there.
   */
  move(fromKey: string, toKey: string, sessionId?: string): number {
    const queue = this.byKey.get(fromKey);
    if (fromKey === toKey || !queue) return 0;
    this.byKey.delete(fromKey);
    const moved = sessionId ? queue.map((entry) => ({ ...entry, sessionId })) : queue;
    const target = this.byKey.get(toKey);
    if (target) target.push(...moved);
    else this.byKey.set(toKey, moved);
    return moved.length;
  }

  /** Everything waiting under one key, dropped — the user stopped that turn. */
  clear(key: string): number {
    const size = this.size(key);
    this.byKey.delete(key);
    return size;
  }

  /** Every queue belonging to one task, dropped — the task itself is gone. */
  clearTask(taskId: string): number {
    let dropped = 0;
    for (const [key, queue] of [...this.byKey]) {
      const kept = queue.filter((entry) => entry.taskId !== taskId);
      dropped += queue.length - kept.length;
      if (kept.length === 0) this.byKey.delete(key);
      else this.byKey.set(key, kept);
    }
    return dropped;
  }

  size(key: string): number {
    return this.byKey.get(key)?.length ?? 0;
  }
}

/**
 * The prompts to show beside a composer aimed at `sessionId`. A turn queued
 * before its session existed carries no session of its own, and belongs to
 * whatever the composer is about to target.
 */
export function queuedForSession(
  task: Pick<BoardTask, 'queued'>,
  sessionId?: string
): QueuedTurn[] {
  return (task.queued || []).filter((turn) => !turn.sessionId || turn.sessionId === sessionId);
}
