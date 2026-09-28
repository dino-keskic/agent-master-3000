import { BoardTask, PendingRequest, SessionChoice, TaskRunState, TaskSessionKind, TaskSessionLink } from '../types.js';

/**
 * One task owns several sessions: the one it started with, forks taken off it
 * ("BTW" side chats), and stage sessions retired by a column transition. They
 * run concurrently, so every question the board asks — what is running, what
 * needs me, where does this prompt go — is answered from this list rather than
 * from the task's single `sessionId`.
 *
 * `task.sessionId` remains the *primary* session: the one a plain follow-up and
 * a column's auto-run turn target. Everything else hangs off `task.sessions`.
 */

/** A link plus the bits of context only the task knows. */
export interface TaskSessionView extends TaskSessionLink {
  /** True for `task.sessionId` — the session a plain follow-up targets. */
  isPrimary: boolean;
  /** True for the session the drawer is currently showing. */
  isActive: boolean;
  runState: TaskRunState;
}

/**
 * An archived session is history, not work in progress.
 *
 * A stage transition retires the session it moved on from, and whatever it was
 * doing ended there — but the last run state it happened to be carrying stayed
 * on the link. Aggregated into the task, that pinned cards at "running" with
 * nothing behind them until the next restart, and no reconciliation looked at
 * archived sessions to put it right.
 */
function isRetired(link: Pick<TaskSessionLink, 'archivedAt'>): boolean {
  return !!link.archivedAt;
}

/** Sessions a task is still working in. Archived stages are read, not run. */
export function liveTaskSessions(task: Partial<BoardTask>): TaskSessionLink[] {
  return listTaskSessions(task).filter((link) => !isRetired(link));
}

/** Highest-priority state wins: a human being blocked beats anything else. */
const RUN_STATE_RANK: Record<TaskRunState, number> = {
  awaiting_input: 3,
  running: 2,
  error: 1,
  idle: 0
};

export function isSessionBusy(runState: TaskRunState | undefined): boolean {
  return runState === 'running' || runState === 'awaiting_input';
}

/** The session a follow-up prompt goes to when the user has not picked one. */
export function primarySessionId(task: Pick<BoardTask, 'sessionId'>): string | undefined {
  return task.sessionId;
}

/** Folder a turn in this session should run in. */
export function sessionCwd(
  task: Pick<BoardTask, 'cwd'>,
  link?: Pick<TaskSessionLink, 'cwd'> | null
): string {
  return link?.cwd || task.cwd;
}

/**
 * What a turn in this session runs as.
 *
 * The task's model is only a default. A session that was started with a pick of
 * its own — a fork asked on a cheaper model, a copy carried into another folder
 * — keeps it, because configuring every turn from the task is how a side chat
 * on one model quietly moved the main conversation onto it.
 */
export function sessionRunSettings(
  task: Pick<BoardTask, 'model' | 'agent' | 'thinkingLevel'>,
  chosen?: SessionChoice
): SessionChoice {
  return {
    model: chosen?.model || task.model,
    agent: chosen?.agent || task.agent,
    thinkingLevel: chosen?.thinkingLevel || task.thinkingLevel
  };
}

/**
 * The model and agent to show for a session, given what OpenCode's database
 * recorded for it. OpenCode writes a session's model when it is created —
 * its own default, whatever the board then switches it to — and only records
 * the switch with the first message. Until the session has one, the board's
 * own answer (the session's pick, else the task's) is the true one; after,
 * what OpenCode recorded is what actually ran.
 */
export function recordedRunSettings(
  task: Pick<BoardTask, 'model' | 'agent' | 'thinkingLevel'>,
  link: Pick<TaskSessionLink, 'model' | 'agent' | 'chosen'>,
  recorded: { model?: string; agent?: string; tokenCount?: number }
): { model?: string; agent?: string } {
  if ((recorded.tokenCount ?? 0) > 0) {
    return { model: recorded.model || link.model, agent: recorded.agent || link.agent };
  }
  const own = sessionRunSettings(task, link.chosen);
  return { model: own.model || link.model, agent: own.agent || link.agent };
}

/**
 * The pick to record for a session, as only what differs from the task. A
 * session running the task's own settings stores nothing, so changing the
 * task's model still carries it — the pick is a deliberate departure, not a
 * snapshot of every default in force when the session started.
 */
export function sessionChoiceOf(
  task: Pick<BoardTask, 'model' | 'agent' | 'thinkingLevel'>,
  chosen: SessionChoice | undefined
): SessionChoice | undefined {
  const pick: SessionChoice = {
    ...(chosen?.model && chosen.model !== task.model ? { model: chosen.model } : {}),
    ...(chosen?.agent && chosen.agent !== task.agent ? { agent: chosen.agent } : {}),
    ...(chosen?.thinkingLevel && chosen.thinkingLevel !== task.thinkingLevel
      ? { thinkingLevel: chosen.thinkingLevel }
      : {})
  };
  return Object.keys(pick).length > 0 ? pick : undefined;
}

/**
 * Where a model/agent/thinking change made while `sessionId` is on screen
 * belongs.
 *
 * The task's settings configure every session it owns, so a change made in a
 * side chat has to stay in that side chat. Changing it in the task's own
 * conversation is changing the task — that is what its settings are.
 */
export function settingsTargetFor(
  task: Pick<BoardTask, 'sessionId'>,
  sessionId: string | undefined
): 'task' | 'session' {
  return !sessionId || sessionId === task.sessionId ? 'task' : 'session';
}

/** The session the drawer shows: the user's pick, else the primary one. */
export function activeSessionIdFor(
  task: Pick<BoardTask, 'sessionId' | 'activeSessionId' | 'sessions'>
): string | undefined {
  const active = task.activeSessionId;
  if (active && sessionExists(task, active)) return active;
  return task.sessionId || listTaskSessions(task)[0]?.sessionId;
}

function sessionExists(task: Pick<BoardTask, 'sessionId' | 'sessions'>, sessionId: string): boolean {
  if (task.sessionId === sessionId) return true;
  return !!task.sessions?.some((s) => s.sessionId === sessionId);
}

const KIND_RANK: Record<TaskSessionKind, number> = { main: 0, btw: 1, stage: 2 };

/**
 * Every session of a task, deduplicated, newest side chat first.
 *
 * A task that predates linked sessions has only `sessionId`; it is synthesized
 * into a 'main' link here so the rest of the board never has to special-case it.
 */
export function listTaskSessions(task: Partial<BoardTask>): TaskSessionLink[] {
  const byId = new Map<string, TaskSessionLink>();

  for (const link of task.sessions || []) {
    if (!link?.sessionId) continue;
    byId.set(link.sessionId, link);
  }

  if (task.sessionId && !byId.has(task.sessionId)) {
    byId.set(task.sessionId, {
      sessionId: task.sessionId,
      title: task.title || 'Session',
      kind: 'main',
      origin: 'initial',
      createdAt: task.createdAt || 0,
      stageColumnId: task.columnId,
      model: task.model,
      agent: task.agent,
      cost: task.cost,
      tokenCount: task.tokenCount,
      lastUserMessage: task.lastUserMessage,
      lastMessage: task.lastMessage,
      runState: task.runState,
      pendingRequest: task.pendingRequest
    });
  }

  // A request parked on the task (no session id on the wire) belongs to the
  // primary session. Overlay it so every reader — notifications included —
  // sees the same pending request the card and drawer already show.
  if (task.pendingRequest && ![...byId.values()].some((link) => link.pendingRequest)) {
    const targetId = (task.sessionId && byId.has(task.sessionId) ? task.sessionId : undefined)
      || [...byId.keys()][0];
    if (targetId) {
      const current = byId.get(targetId);
      if (current && !current.pendingRequest) {
        byId.set(targetId, { ...current, pendingRequest: task.pendingRequest });
      }
    }
  }

  return [...byId.values()].sort((a, b) => {
    const archived = Number(!!a.archivedAt) - Number(!!b.archivedAt);
    if (archived !== 0) return archived;
    const kind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (kind !== 0) return kind;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  });
}

/** The same list, marked up with which session is primary and which is on screen. */
export function taskSessionViews(task: BoardTask): TaskSessionView[] {
  const active = activeSessionIdFor(task);
  return listTaskSessions(task).map((link) => ({
    ...link,
    isPrimary: link.sessionId === task.sessionId,
    isActive: link.sessionId === active,
    runState: sessionRunState(task, link)
  }));
}

/**
 * A session's state. Links written before per-session tracking have none, so
 * the primary session falls back to the task's aggregate and the rest to idle —
 * never to 'running', which would strand a card in a state nothing clears.
 */
/**
 * The request this session is blocked on. A task-level park (no session id on
 * the wire) belongs to the primary session, but never to a fork — a fork with
 * its own pending request is already copied onto `task.pendingRequest`.
 */
export function sessionPendingRequest(
  task: Pick<BoardTask, 'sessionId' | 'pendingRequest' | 'sessions'>,
  link: Pick<TaskSessionLink, 'sessionId' | 'pendingRequest'>
): PendingRequest | undefined {
  if (link.pendingRequest) return link.pendingRequest;
  if (link.sessionId !== task.sessionId) return undefined;
  if ((task.sessions || []).some((session) => session.pendingRequest)) return undefined;
  return task.pendingRequest;
}

export function sessionRunState(
  task: Pick<BoardTask, 'sessionId' | 'runState' | 'pendingRequest' | 'sessions'>,
  link: Pick<TaskSessionLink, 'sessionId' | 'runState' | 'pendingRequest' | 'archivedAt'>
): TaskRunState {
  if (isRetired(link)) return 'idle';
  if (sessionPendingRequest(task, link)) return 'awaiting_input';
  if (link.runState) return link.runState;
  if (link.sessionId === task.sessionId) return task.runState || 'idle';
  return 'idle';
}

/**
 * The card's state: the most demanding thing any of its sessions is doing.
 * `fallback` covers a task whose only session has no recorded state yet.
 */
export function aggregateRunState(sessions: TaskSessionLink[], fallback: TaskRunState = 'idle'): TaskRunState {
  let best: TaskRunState | undefined;
  for (const session of sessions) {
    if (isRetired(session)) continue;
    const state = session.runState;
    if (!state) continue;
    if (!best || RUN_STATE_RANK[state] > RUN_STATE_RANK[best]) best = state;
  }
  return best ?? fallback;
}

/** How many of a task's sessions are mid-turn — what the card badge counts. */
export function busySessionCount(task: BoardTask): number {
  return taskSessionViews(task).filter((view) => isSessionBusy(view.runState)).length;
}

/** One row of the board-wide activity list. */
export interface SessionActivityItem {
  taskId: string;
  taskTitle: string;
  columnId: string;
  cwd: string;
  projectName?: string;
  worktreeLabel?: string;
  session: TaskSessionView;
}

const ACTIVITY_RANK: Record<TaskRunState, number> = {
  awaiting_input: 0,
  running: 1,
  error: 2,
  idle: 3
};

/**
 * Every session on the board, flattened. Sorted the way a person triages:
 * what is blocked on me, then what is running, then what broke, then the rest
 * by recency.
 */
export function boardSessionActivity(tasks: BoardTask[]): SessionActivityItem[] {
  const items: SessionActivityItem[] = [];
  for (const task of tasks) {
    for (const session of taskSessionViews(task)) {
      items.push({
        taskId: task.id,
        taskTitle: task.title,
        columnId: task.columnId,
        cwd: task.cwd,
        projectName: task.projectName,
        worktreeLabel: task.worktreeLabel,
        session
      });
    }
  }
  return items.sort((a, b) => {
    const rank = ACTIVITY_RANK[a.session.runState] - ACTIVITY_RANK[b.session.runState];
    if (rank !== 0) return rank;
    const aTime = a.session.updatedAt || a.session.createdAt || 0;
    const bTime = b.session.updatedAt || b.session.createdAt || 0;
    return bTime - aTime;
  });
}

export interface ActivityCounts {
  awaiting: number;
  running: number;
  error: number;
  idle: number;
  total: number;
}

export function activityCounts(items: SessionActivityItem[]): ActivityCounts {
  const counts: ActivityCounts = { awaiting: 0, running: 0, error: 0, idle: 0, total: items.length };
  for (const item of items) {
    if (item.session.runState === 'awaiting_input') counts.awaiting++;
    else if (item.session.runState === 'running') counts.running++;
    else if (item.session.runState === 'error') counts.error++;
    else counts.idle++;
  }
  return counts;
}

/** Badge text for a session: what it is, in the fewest words that stay true. */
export function sessionOriginLabel(link: Pick<TaskSessionLink, 'kind' | 'origin'>): string {
  if (link.kind === 'btw') return 'Fork';
  if (link.kind === 'stage') return 'Stage';
  if (link.origin === 'new') return 'New';
  return 'Main';
}
