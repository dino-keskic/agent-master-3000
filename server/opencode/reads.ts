import { loadSessionHistory } from './history.js';
import { activeRootSessionIds } from './liveTurns.js';
import { getOpenCodeSessionsById } from './sessionList.js';

/**
 * The OpenCode database reads that may run on the reader thread.
 *
 * These are the ones the background poll makes, and `node:sqlite` is
 * synchronous: against a database of tens of gigabytes one of them can hold
 * the event loop for seconds, and every request that arrives meanwhile waits
 * it out. A read belongs here when its arguments and its answer are plain data
 * (they cross a thread by structured clone) and it depends on nothing but the
 * database — no board state, no clock it reads for itself.
 */
export const READS = {
  /** `boardStartedAt` is the main thread's: the reader thread starts later. */
  activeRootSessionIds: (ids: string[], now: number, boardStartedAt: number) =>
    activeRootSessionIds(ids, now, boardStartedAt),
  sessionHistory: (sessionId: string, since: number) => loadSessionHistory(sessionId, since),
  sessionsById: (ids: string[]) => getOpenCodeSessionsById(ids)
};

export type ReadName = keyof typeof READS;

export type ReadRequest = { id: number; name: ReadName; args: unknown[]; dbPath: string };
export type ReadReply = { id: number; value?: unknown; error?: string };

/** Run one read by name, wherever this is called from. */
export function runRead(name: ReadName, args: unknown[]): unknown {
  return (READS[name] as (...a: unknown[]) => unknown)(...args);
}
