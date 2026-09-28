import { BoardColumn, BoardState, BoardTask, SessionStageEntry, TaskRunState } from '../types.js';
import { looksLikeColumnPrompt, resolveColumnId, sanitizeColumns, userTaskPrompt } from './columns.js';
import { trimTaskLogs } from '../task/logWrites.js';
import { sweepStaleTools } from '../agent/staleTools.js';
import { dropUnusedSeededProject } from '../setup/onboarding.js';

/**
 * Repairing a board that was just read off disk.
 *
 * The file outlives the process that wrote it, so it can hold tasks from older
 * shapes of the app and state that only made sense while something was
 * running. Everything here brings one of those back to what the current board
 * can work with, and reports whether the file needs rewriting.
 */

const RESTING_RUN_STATES: TaskRunState[] = ['idle', 'error'];

function parseTaskNumber(id: string): number | null {
  const match = /^TASK-(\d+)$/.exec(id);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/** Allocates the next unused TASK-nnn id and advances the persisted counter. */
export function allocateTaskId(state: BoardState): string {
  const existing = new Set(state.tasks.map((t) => t.id));
  let num = state.nextTaskNumber;
  while (existing.has(`TASK-${num}`)) {
    num++;
  }
  state.nextTaskNumber = num + 1;
  return `TASK-${num}`;
}

/**
 * Brings one task up to date: onto a column that exists, out of any run state
 * that died with the previous process, and with its prompt fields consistent.
 */
export function normalizeTask(task: BoardTask, columns: BoardColumn[]): boolean {
  let changed = false;
  const legacyStatus = (task as BoardTask & { status?: string }).status;
  const resolved = resolveColumnId(columns, task.columnId, legacyStatus);
  if (task.columnId !== resolved) {
    task.columnId = resolved;
    changed = true;
  }
  if (legacyStatus !== undefined) {
    delete (task as BoardTask & { status?: string }).status;
    changed = true;
  }
  if (task.pendingRequest) {
    // The parked JSON-RPC id died with the previous process; nothing can
    // answer this request any more.
    delete task.pendingRequest;
    changed = true;
  }
  // Turns do not survive process restart, and neither does anything the file
  // carries that is not a resting state at all.
  if (!RESTING_RUN_STATES.includes(task.runState)) {
    task.runState = 'idle';
    changed = true;
  }
  // Same for each linked session: a fork recorded as running would otherwise
  // stay "active" forever, since nothing is left to report that it finished.
  // syncRunStatesFromOpenCode re-marks the ones actually still working.
  for (const link of task.sessions || []) {
    if (link.pendingRequest) {
      delete link.pendingRequest;
      changed = true;
    }
    if (link.runState === 'running' || link.runState === 'awaiting_input') {
      link.runState = 'idle';
      changed = true;
    }
  }
  // Every session is resting now, so any tool call the file still calls live
  // was in flight when the previous process ended. Nothing can report it.
  const swept = sweepStaleTools(task, 'Interrupted by a restart');
  if (swept.changed.length > 0) {
    task.logs = swept.logs;
    changed = true;
  }
  const original = userTaskPrompt(task);
  if (original && task.originalPrompt !== original) {
    task.originalPrompt = original;
    changed = true;
  }
  if (original && task.prompt !== original) {
    task.prompt = original;
    if (task.description && looksLikeColumnPrompt(task.description)) {
      task.description = original;
    }
    changed = true;
  }
  if (trimTaskLogs(task)) changed = true;
  // After the log trim, so it reads whatever move history survived it.
  if (backfillSessionStages(task, columns)) changed = true;
  return changed;
}

/** How `taskStore.moveTask` words the log line it writes on every move. */
const MOVED_LOG = /^Moved from (.+) to (.+)\.$/;

/**
 * Rebuild the stage history of sessions that pre-date it, from the task's own
 * move log.
 *
 * Without this the fix only helps tasks moved from here on: every task already
 * on the board would keep reporting its whole spend against the column its
 * session happened to start in, which is the reading that was wrong in the
 * first place. The board has written a timestamped "Moved from X to Y" line on
 * every move all along, so the history is recoverable rather than lost.
 *
 * Columns are matched by the title the log recorded. A renamed or deleted
 * column no longer matches, and that move is skipped — a partial history still
 * splits the moves it can place, and a session with none is left exactly as it
 * reads today.
 */
function backfillSessionStages(task: BoardTask, columns: BoardColumn[]): boolean {
  const live = (task.sessions || []).filter((link) => !link.archivedAt && !link.stages);
  if (live.length === 0) return false;

  const idForTitle = new Map<string, string>();
  for (const column of columns) {
    // An ambiguous title identifies nothing; leave those moves unplaced.
    idForTitle.set(column.title, idForTitle.has(column.title) ? '' : column.id);
  }

  const moves: SessionStageEntry[] = [];
  for (const log of task.logs) {
    if (log.type !== 'status_change' || log.title !== 'Moved') continue;
    const to = MOVED_LOG.exec(log.text)?.[2];
    if (!to) continue;
    const columnId = idForTitle.get(to) || (columns.some((column) => column.id === to) ? to : '');
    if (!columnId) continue;
    moves.push({ columnId, at: log.timestamp });
  }

  let changed = false;
  for (const link of live) {
    const start = link.stageColumnId ? [{ columnId: link.stageColumnId, at: link.createdAt || 0 }] : [];
    // Only the moves this session was alive for, and only the ones that
    // actually changed column — a card dragged out and back is not two phases.
    const stages = [...start, ...moves.filter((move) => move.at >= (link.createdAt || 0))]
      .sort((a, b) => a.at - b.at)
      .filter((move, index, all) => index === 0 || all[index - 1]?.columnId !== move.columnId);
    if (stages.length === 0) continue;
    link.stages = stages;
    link.stageColumnId = stages[stages.length - 1]?.columnId ?? link.stageColumnId;
    changed = true;
  }
  return changed;
}

/**
 * Repairs a loaded board: seeds the id counter, reassigns duplicate ids, and
 * migrates legacy status columns onto columnId + runState.
 */
export function normalizeBoardState(state: BoardState): boolean {
  let changed = false;

  const sanitized = sanitizeColumns(state.settings.columns);
  if (JSON.stringify(sanitized) !== JSON.stringify(state.settings.columns)) {
    state.settings.columns = sanitized;
    changed = true;
  } else {
    state.settings.columns = sanitized;
  }

  let highest = 100;
  for (const task of state.tasks) {
    const num = parseTaskNumber(task.id);
    if (num !== null && num > highest) highest = num;
  }

  if (typeof state.nextTaskNumber !== 'number' || !Number.isFinite(state.nextTaskNumber) || state.nextTaskNumber <= highest) {
    state.nextTaskNumber = highest + 1;
    changed = true;
  }

  const seen = new Set<string>();
  for (const task of state.tasks) {
    if (seen.has(task.id)) {
      const previousId = task.id;
      task.id = allocateTaskId(state);
      console.warn(`[Store] Duplicate task id "${previousId}" reassigned to "${task.id}"`);
      changed = true;
    }
    seen.add(task.id);
    if (normalizeTask(task, state.settings.columns)) changed = true;
  }

  if (dropUnusedSeededProject(state)) changed = true;

  return changed;
}
