import { BoardState, BoardTask, TaskLogItem } from '../types.js';

/**
 * How the board is laid out on disk: one small document for the board itself,
 * and one file per task for its transcript.
 *
 * Transcripts are nearly all of the bytes (a busy board is megabytes of tool
 * output) and nearly all of the churn (a streaming turn rewrites them several
 * times a second), while everything else changes a few times a minute. Kept in
 * one file, every run-state flip re-serialised every transcript on the board.
 * Split, a change costs the size of what changed.
 *
 * Pure: the store does the reading and writing, this decides what goes where.
 */

/** A task as the board document stores it — everything but the transcript. */
export type StoredTask = Omit<BoardTask, 'logs'> & { logs?: TaskLogItem[] };

/**
 * The board document without transcripts. Tasks are shallow copies, so the
 * live state is never touched; a session link's own `logs` is not a
 * transcript file's business and stays where it is.
 */
export function boardDocument(state: BoardState): Omit<BoardState, 'tasks'> & { tasks: StoredTask[] } {
  return {
    ...state,
    tasks: state.tasks.map((task) => {
      const { logs: _logs, ...rest } = task;
      return rest;
    })
  };
}

/**
 * What a task's transcript looked like when it was last written: the entries
 * themselves, not a copy of their contents. Every write path replaces an entry
 * rather than editing it (see taskLogWrites), so identity is enough to tell a
 * changed transcript from an unchanged one without serialising either.
 */
export type WrittenLogs = Map<string, readonly TaskLogItem[]>;

function sameEntries(a: readonly TaskLogItem[], b: readonly TaskLogItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** The tasks whose transcript is not what was last written for them. */
export function changedTranscripts(tasks: readonly BoardTask[], written: WrittenLogs): BoardTask[] {
  return tasks.filter((task) => {
    const previous = written.get(task.id);
    return !previous || !sameEntries(previous, task.logs);
  });
}

/** Task ids with a transcript on disk that are no longer on the board. */
export function orphanedTranscripts(tasks: readonly BoardTask[], onDisk: Iterable<string>): string[] {
  const live = new Set(tasks.map((task) => task.id));
  return [...onDisk].filter((taskId) => !live.has(taskId));
}

const TRANSCRIPT_SUFFIX = '.json';

/**
 * The transcript's file name. Task ids are `TASK-nnn` today, but they come out
 * of a file anyone can edit, so they are encoded rather than trusted as a path.
 */
export function transcriptFileName(taskId: string): string {
  return `${encodeURIComponent(taskId)}${TRANSCRIPT_SUFFIX}`;
}

/** The task a transcript file belongs to, or null for anything else in the folder. */
export function transcriptTaskId(fileName: string): string | null {
  if (!fileName.endsWith(TRANSCRIPT_SUFFIX)) return null;
  try {
    return decodeURIComponent(fileName.slice(0, -TRANSCRIPT_SUFFIX.length)) || null;
  } catch {
    return null;
  }
}
