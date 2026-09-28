import {
  BoardTask,
  PendingRequest,
  SessionChoice,
  SessionOrigin,
  SessionStageEntry,
  TaskRunState,
  TaskSessionKind,
  TaskSessionLink
} from '../types.js';
import { aggregateRunState, sessionChoiceOf, sessionRunSettings } from './sessions.js';

/**
 * Writes to a task's session links.
 *
 * A task can hold several ACP sessions at once — the main conversation, a
 * fork, an archived stage run — and they progress independently. Everything
 * here is bookkeeping for that: which one is primary, what each is doing, and
 * what the task's own state works out to as a result.
 */

/**
 * The link for a session, created from the task if it is missing.
 *
 * Tasks written before sessions were tracked have only `sessionId`, and every
 * per-session write below needs somewhere to put its state — so the primary
 * session is materialized on first touch rather than left implicit.
 */
export function ensureSessionLink(task: BoardTask, sessionId: string): TaskSessionLink {
  if (!task.sessions) task.sessions = [];
  const found = task.sessions.find((s) => s.sessionId === sessionId);
  if (found) return found;

  const isPrimary = task.sessionId === sessionId;
  const link: TaskSessionLink = {
    sessionId,
    title: isPrimary ? task.title : 'Session',
    kind: 'main',
    origin: isPrimary ? 'initial' : 'new',
    createdAt: isPrimary ? task.createdAt : Date.now(),
    updatedAt: Date.now(),
    stageColumnId: task.columnId,
    model: task.model,
    agent: task.agent,
    thinkingLevel: task.thinkingLevel,
    ...(isPrimary
      ? {
          cost: task.cost,
          tokenCount: task.tokenCount,
          lastUserMessage: task.lastUserMessage,
          lastMessage: task.lastMessage,
          runState: task.runState
        }
      : {})
  };
  task.sessions.push(link);
  return link;
}

/**
 * Record what one session was told to run as.
 *
 * Only what differs from the task is kept, so a session left on the task's
 * settings keeps following them rather than freezing today's model.
 */
export function setLinkChoice(task: BoardTask, sessionId: string, choice: SessionChoice): void {
  const link = ensureSessionLink(task, sessionId);
  const chosen = sessionChoiceOf(task, { ...link.chosen, ...choice });
  link.chosen = chosen;
  Object.assign(link, sessionRunSettings(task, chosen));
  link.updatedAt = Date.now();
  task.updatedAt = Date.now();
}

/**
 * Retire a session link: it is history now, and the board will not send it
 * another turn. Whatever run state it was carrying goes with it — a link
 * archived mid-turn used to keep its task reading "running" with nothing
 * left that could ever report otherwise.
 */
export function archiveLink(link: TaskSessionLink): void {
  link.archivedAt = Date.now();
  link.updatedAt = Date.now();
  link.runState = 'idle';
  link.pendingRequest = undefined;
}

/**
 * The task's state is the most demanding thing any of its sessions is doing,
 * so the card still reads "waiting for you" when one fork blocks while the
 * main session keeps working.
 */
export function recomputeRunState(task: BoardTask): void {
  const links = task.sessions || [];
  if (links.length === 0) return;
  const next = aggregateRunState(links, 'idle');
  if (task.runState !== next) {
    task.runState = next;
    if (next === 'running') task.error = undefined;
  }
  task.pendingRequest = links.find((link) => link.pendingRequest)?.pendingRequest;
  if (next !== 'error') {
    task.error = links.find((link) => link.error)?.error;
  }
}

/** Adds a link, or merges the fields onto the one already there. */
export function upsertSessionLink(task: BoardTask, link: TaskSessionLink): void {
  if (!task.sessions) task.sessions = [];
  const idx = task.sessions.findIndex((s) => s.sessionId === link.sessionId);
  if (idx >= 0) {
    task.sessions[idx] = { ...task.sessions[idx], ...link, updatedAt: Date.now() };
  } else {
    task.sessions.push({ ...link, updatedAt: Date.now() });
  }
  recomputeRunState(task);
  task.updatedAt = Date.now();
}

/** Records what one session is doing. False when it was already doing that. */
export function setLinkRunState(task: BoardTask, sessionId: string, runState: TaskRunState): boolean {
  const link = ensureSessionLink(task, sessionId);
  if (link.runState === runState) {
    recomputeRunState(task);
    return false;
  }
  link.runState = runState;
  link.updatedAt = Date.now();
  if (runState === 'running') link.error = undefined;
  if (runState !== 'awaiting_input') link.pendingRequest = undefined;
  recomputeRunState(task);
  task.updatedAt = Date.now();
  return true;
}

/** Parks or clears the request one session is blocked on. False when nothing changed. */
export function setLinkPendingRequest(
  task: BoardTask,
  sessionId: string,
  request: PendingRequest | undefined
): boolean {
  const link = ensureSessionLink(task, sessionId);
  if (!link.pendingRequest && !request) return false;

  link.pendingRequest = request;
  if (request) {
    link.runState = 'awaiting_input';
  } else if (link.runState === 'awaiting_input') {
    link.runState = 'running';
  }
  link.updatedAt = Date.now();
  recomputeRunState(task);
  task.updatedAt = Date.now();
  return true;
}

/** Clears whatever any session of this task was blocked on. */
export function clearLinkPendingRequests(task: BoardTask): void {
  for (const link of task.sessions || []) {
    if (!link.pendingRequest) continue;
    link.pendingRequest = undefined;
    if (link.runState === 'awaiting_input') link.runState = 'idle';
  }
  task.pendingRequest = undefined;
  recomputeRunState(task);
  task.updatedAt = Date.now();
}

/**
 * Promote a session to primary — the one plain follow-ups and column auto-runs
 * target. The session it replaces stays linked and readable; it is archived so
 * the list can show it as history rather than as somewhere still being worked.
 */
export function promotePrimarySession(
  task: BoardTask,
  sessionId: string,
  options: { archivePrevious?: boolean } = {}
): void {
  const previousId = task.sessionId;
  if (options.archivePrevious && previousId && previousId !== sessionId) {
    archiveLink(ensureSessionLink(task, previousId));
  }

  task.sessionId = sessionId;
  task.activeSessionId = sessionId;
  const link = ensureSessionLink(task, sessionId);
  link.archivedAt = undefined;
  link.updatedAt = Date.now();
  // The session that was just retired may have been the one holding the card
  // in progress; the task's state has to follow it down.
  recomputeRunState(task);
  task.updatedAt = Date.now();
}

export interface LinkedSessionInput {
  sessionId: string;
  title: string;
  kind: TaskSessionKind;
  origin: SessionOrigin;
  forkedFrom?: string;
  costAtFork?: number;
  prompt?: string;
  /**
   * What this session was told to run as, when the user picked something other
   * than the task's settings. Recorded on the link so a fork started on another
   * model keeps it — and does not drag the task, or the task's other sessions,
   * onto it.
   */
  chosen?: SessionChoice;
  cwd?: string;
  projectId?: string;
  projectName?: string;
  primary?: boolean;
  /**
   * The session this one takes over from. Passed explicitly because
   * `session_bound` already moved `task.sessionId` onto the new session by
   * the time this runs, so the caller is the only one that still knows.
   */
  supersedes?: string;
}

/**
 * Link a session that was just created or forked for this task.
 *
 * `primary` promotes it in the same write, so a "new session to continue"
 * never leaves the board with two sessions claiming to be the live one.
 */
export function applyLinkedSession(task: BoardTask, input: LinkedSessionInput): void {
  const superseded = input.supersedes ?? task.sessionId;
  // Naming what it supersedes retires that session even for a side session —
  // a handoff replaces a session whatever its standing.
  if ((input.primary || input.supersedes) && superseded && superseded !== input.sessionId) {
    archiveLink(ensureSessionLink(task, superseded));
  }

  if (!task.sessions) task.sessions = [];
  const existing = task.sessions.find((s) => s.sessionId === input.sessionId);
  const link: TaskSessionLink = {
    ...(existing || {}),
    sessionId: input.sessionId,
    title: input.title,
    kind: input.kind,
    origin: input.origin,
    forkedFrom: input.forkedFrom,
    costAtFork: input.costAtFork ?? existing?.costAtFork,
    prompt: input.prompt ?? existing?.prompt,
    cwd: input.cwd ?? existing?.cwd,
    projectId: input.projectId ?? existing?.projectId,
    projectName: input.projectName ?? existing?.projectName,
    lastUserMessage: input.prompt ?? existing?.lastUserMessage,
    chosen: input.chosen ?? existing?.chosen,
    ...sessionRunSettings(task, input.chosen ?? existing?.chosen),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    archivedAt: undefined,
    stageColumnId: task.columnId
  };
  // A relinked session may have been retired in another column and put back to
  // work here; stamp the crossing so its spend splits at it. A session being
  // linked for the first time is stamped at its creation, not at now, so its
  // first stage covers the whole conversation.
  noteLinkStage(link, task.columnId, existing ? Date.now() : link.createdAt);
  if (existing) {
    task.sessions[task.sessions.indexOf(existing)] = link;
  } else {
    task.sessions.push(link);
  }

  if (input.primary) {
    task.sessionId = input.sessionId;
  }
  task.activeSessionId = input.sessionId;
  recomputeRunState(task);
  task.updatedAt = Date.now();
}

/**
 * The columns a session has worked in, oldest first.
 *
 * Links written before stage history existed have no `stages`; they report the
 * single column they were stamped with, which is what the spend breakdown said
 * about them all along.
 */
export function sessionStages(link: Pick<TaskSessionLink, 'stages' | 'stageColumnId' | 'createdAt'>): SessionStageEntry[] {
  const recorded = (link.stages || []).filter((stage) => Boolean(stage.columnId));
  if (recorded.length > 0) return [...recorded].sort((a, b) => a.at - b.at);
  if (!link.stageColumnId) return [];
  return [{ columnId: link.stageColumnId, at: link.createdAt || 0 }];
}

/**
 * Note that every live session of this task is now working in `columnId`.
 *
 * A stage column that does not demand a fresh session leaves one session
 * spanning several stages. Recording the crossing is what lets spend be split
 * at it later; without it the whole session bills to wherever it started.
 *
 * Archived links are left alone — their work is finished, and a move after the
 * fact does not put them back to work. A move that lands back in the column a
 * session is already in records nothing, so dragging a card out and back does
 * not manufacture empty phases.
 */
export function recordStageEntry(task: BoardTask, columnId: string, at = Date.now()): void {
  for (const link of task.sessions || []) {
    if (!link.sessionId || link.archivedAt) continue;
    noteLinkStage(link, columnId, at);
  }
}

/** `recordStageEntry` for one link, whatever the reason it is being stamped. */
function noteLinkStage(link: TaskSessionLink, columnId: string, at: number): void {
  const stages = sessionStages(link);
  link.stageColumnId = columnId;
  if (stages[stages.length - 1]?.columnId === columnId) {
    link.stages = stages;
    return;
  }
  link.stages = [...stages, { columnId, at }];
}

/**
 * Retire the current session as this column's finished work, leaving the task
 * with no live session — the next stage turn starts a fresh one.
 */
export function archiveStageLink(task: BoardTask, sessionId: string, fromColumnId: string): void {
  const existing = ensureSessionLink(task, sessionId);
  existing.kind = 'stage';
  existing.origin = 'stage';
  existing.stageColumnId = fromColumnId;
  archiveLink(existing);
  if (!existing.title || existing.title === task.title) {
    existing.title = task.title;
  }
  existing.cost = existing.cost ?? task.cost;
  existing.tokenCount = existing.tokenCount ?? task.tokenCount;
  existing.lastUserMessage = existing.lastUserMessage ?? task.lastUserMessage;
  existing.lastMessage = existing.lastMessage ?? task.lastMessage;

  task.sessionId = undefined;
  task.activeSessionId = undefined;
  recomputeRunState(task);
  task.updatedAt = Date.now();
}
