/**
 * Pure presentation and grouping rules for the task sidebar's session list.
 *
 * A task can carry a main thread, concurrent forks branched off it, and older
 * archived runs. Grouping live threads (with forks nested under their parent)
 * separately from earlier archived runs makes that structure readable at a
 * glance without duplicating the task's own title on every row.
 */

import { deriveTaskTitle, isPlaceholderSessionTitle } from '../format.js';
import { SubagentSession } from '../sessions/types.js';
import { findSubagent, runningSubagentCount } from '../sessions/subagents.js';
import { isSessionBusy, TaskSessionView } from './sessions.js';

export interface SessionTreeEntry {
  session: TaskSessionView;
  /** True when nested under its live parent session as a visual branch. */
  isBranch: boolean;
}

export interface GroupedTaskSessions {
  /** Active/live sessions in tree order (roots followed by their live forks). */
  live: SessionTreeEntry[];
  /** Retired runs kept for reading, sorted newest first. */
  archived: TaskSessionView[];
}

function normalize(text: string | undefined): string {
  return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The distinguishing single-line label for a session row.
 *
 * Most sessions on a task inherit the task's title ("Workout feature edit
 * issues…"), so listing that title five times makes every row identical. When
 * the session's own title just repeats the task title — or is a generic
 * placeholder — use its last user prompt or starting prompt instead.
 */
export function sessionDisplayTitle(
  session: Pick<TaskSessionView, 'title' | 'lastUserMessage' | 'prompt' | 'isPrimary'>,
  taskTitle: string
): string {
  const rawTitle = (session.title || '').replace(/\s+/g, ' ').trim();
  const sameAsTask = !!rawTitle && normalize(rawTitle) === normalize(taskTitle);
  const generic = !rawTitle || sameAsTask || isPlaceholderSessionTitle(rawTitle);

  if (!generic) return rawTitle;

  const candidate = (session.lastUserMessage || session.prompt || '').trim();
  if (candidate) return deriveTaskTitle(candidate, rawTitle || 'Session');

  if (rawTitle) return rawTitle;
  return session.isPrimary ? 'Main thread' : 'Session';
}

/** Short role indicator for the row's top meta line. */
export function sessionRoleLabel(
  session: Pick<TaskSessionView, 'isPrimary' | 'kind' | 'origin' | 'archivedAt' | 'forkedAtLabel' | 'runState'>
): string {
  if (session.runState === 'awaiting_input') return 'Waiting for you';
  if (session.runState === 'running') return session.isPrimary ? 'Running · Main' : 'Running';
  if (session.runState === 'error') return 'Error';
  if (session.isPrimary) return 'Main thread';
  if (session.kind === 'btw' || session.origin === 'fork') {
    return session.forkedAtLabel ? `Fork · ${session.forkedAtLabel}` : 'Fork';
  }
  if (session.archivedAt) return session.kind === 'stage' ? 'Archived stage' : 'Archived';
  if (session.origin === 'new') return 'New thread';
  return 'Thread';
}

/**
 * Group a task's sessions into live threads (with forks nested immediately
 * beneath their live parent) and earlier archived runs.
 */
export function groupTaskSessions(sessions: TaskSessionView[]): GroupedTaskSessions {
  const liveList: TaskSessionView[] = [];
  const archived: TaskSessionView[] = [];

  for (const session of sessions) {
    if (session.archivedAt) archived.push(session);
    else liveList.push(session);
  }

  // Primary thread first, then anything busy, then newest activity.
  const rankLive = (a: TaskSessionView, b: TaskSessionView): number => {
    const primary = Number(b.isPrimary) - Number(a.isPrimary);
    if (primary !== 0) return primary;
    const busy = Number(isSessionBusy(b.runState)) - Number(isSessionBusy(a.runState));
    if (busy !== 0) return busy;
    return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
  };

  const liveById = new Map(liveList.map((s) => [s.sessionId, s]));
  const childrenByParent = new Map<string, TaskSessionView[]>();
  const roots: TaskSessionView[] = [];

  for (const session of liveList) {
    const parentId = session.forkedFrom;
    if (parentId && parentId !== session.sessionId && liveById.has(parentId) && !session.isPrimary) {
      const siblings = childrenByParent.get(parentId);
      if (siblings) siblings.push(session);
      else childrenByParent.set(parentId, [session]);
    } else {
      roots.push(session);
    }
  }

  roots.sort(rankLive);

  const live: SessionTreeEntry[] = [];
  const visited = new Set<string>();
  const appendTree = (node: TaskSessionView, isBranch: boolean) => {
    if (visited.has(node.sessionId)) return;
    visited.add(node.sessionId);
    live.push({ session: node, isBranch });
    const kids = childrenByParent.get(node.sessionId);
    if (!kids) return;
    kids.sort(rankLive);
    for (const kid of kids) appendTree(kid, true);
  };

  for (const root of roots) appendTree(root, false);
  // Guard against a fork cycle where neither node looked like a root.
  for (const remaining of liveList) {
    if (!visited.has(remaining.sessionId)) appendTree(remaining, false);
  }

  archived.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  return { live, archived };
}

export interface SubagentSummary {
  count: number;
  running: number;
  totalCost: number;
}

function countAllSubagents(nodes: SubagentSession[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countAllSubagents(node.children), 0);
}

/**
 * Total count, active count, and spend for a session's subagent tree, used on
 * the single collapsed disclosure row under a session.
 */
export function subagentSummary(nodes: SubagentSession[]): SubagentSummary {
  const totalCost = nodes.reduce((sum, node) => sum + (node.treeCost ?? node.cost ?? 0), 0);
  return {
    count: countAllSubagents(nodes),
    running: runningSubagentCount(nodes),
    totalCost
  };
}

/**
 * Finished subagents stay folded behind one summary row so Usage and Links
 * stay on screen. Auto-expand only when one is actively running or open.
 */
export function shouldAutoExpandSubagents(
  nodes: SubagentSession[],
  viewedSessionId: string | undefined
): boolean {
  if (nodes.length === 0) return false;
  if (runningSubagentCount(nodes) > 0) return true;
  return !!viewedSessionId && !!findSubagent(nodes, viewedSessionId);
}
