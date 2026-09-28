/**
 * Which conversation the task drawer is showing.
 *
 * A task can have several sessions running at once, and each of those can have
 * subagents under it — so "the session on screen" is not simply
 * `task.sessionId`. Everything the drawer needs to know about the one being
 * viewed is worked out here, in one pass, because the answers depend on each
 * other: whether it is a subagent decides where its run state comes from, and
 * which session it descends from decides who is named as its caller.
 */

import { SubagentSession } from '../sessions/types.js';
import { BoardTask, TaskLogItem, TaskRunState } from '../types.js';
import { findSubagent, SubagentCaller, subagentCaller, subagentLabel } from '../sessions/subagents.js';
import { isSessionBusy, sessionOriginLabel, TaskSessionView, taskSessionViews } from './sessions.js';

export interface ViewedSession {
  /** Every linked session of the task, in display order. */
  sessions: TaskSessionView[];
  /** The linked session being viewed, when it is one of them. */
  viewed?: TaskSessionView;
  /** The subagent being viewed, when the drawer descended into one. */
  subagent?: SubagentSession;
  /** The linked session whose tree the viewed subagent belongs to. */
  subagentRoot?: TaskSessionView;
  isSubagentView: boolean;
  /** Who spawned the subagent being viewed — nobody typed into that session. */
  caller?: SubagentCaller;
  /** The run state to show: a subagent transcript is always read-only history. */
  runState: TaskRunState;
  busy: boolean;
  /** True when the view is not the session a plain follow-up would go to. */
  isSideSession: boolean;
  /** Sessions of this task, other than this one, that are still working. */
  otherBusyCount: number;
}

export function resolveViewedSession(
  task: BoardTask,
  activeSessionId: string | undefined,
  subagents: Record<string, SubagentSession[]> = {}
): ViewedSession {
  const sessions = taskSessionViews(task);
  const viewed = sessions.find((s) => s.sessionId === activeSessionId);
  const isSubagentView = !!activeSessionId && !viewed;

  // Which linked session's tree holds the subagent on screen. Flattening every
  // tree together would find the node but lose the session it descends from,
  // and that session is what names the caller at the top of the chain.
  const rootId = activeSessionId
    ? Object.keys(subagents).find((id) => !!findSubagent(subagents[id] || [], activeSessionId))
    : undefined;
  const subagentRoot = rootId ? sessions.find((s) => s.sessionId === rootId) : undefined;
  const tree = rootId ? subagents[rootId] || [] : [];

  const runState = isSubagentView ? 'idle' : (viewed?.runState ?? task.runState);
  return {
    sessions,
    viewed,
    subagent: rootId && activeSessionId ? findSubagent(tree, activeSessionId) : undefined,
    subagentRoot,
    isSubagentView,
    caller: rootId && activeSessionId
      ? subagentCaller(
          tree,
          activeSessionId,
          subagentRoot?.agent ? `@${subagentRoot.agent}` : (subagentRoot?.title || 'the main session')
        )
      : undefined,
    runState,
    busy: isSessionBusy(runState),
    isSideSession: !!activeSessionId && activeSessionId !== task.sessionId,
    otherBusyCount: sessions.filter(
      (s) => s.sessionId !== activeSessionId && isSessionBusy(s.runState)
    ).length
  };
}

/**
 * Whether the transcript is still on its way, as opposed to genuinely empty.
 *
 * The board trims long transcripts out of the snapshot it broadcasts, and a
 * subagent's history is never in it at all — both are fetched per session. Until
 * that fetch lands there is nothing to render, and "no messages yet" would be a
 * lie about a conversation that has plenty.
 */
export function transcriptPending(
  task: BoardTask,
  view: ViewedSession,
  fetchedLogs: TaskLogItem[] | undefined
): boolean {
  if (fetchedLogs) return false;
  // A subagent view is by definition a session the snapshot does not carry.
  if (view.isSubagentView) return true;
  return !!task.logsOmitted && task.logs.length === 0;
}

/**
 * A session's title is often the whole prompt that started it, which makes a
 * useless placeholder. Clip it to something that still identifies the session.
 */
export function shortSessionLabel(title: string | undefined, max = 32): string {
  const text = (title || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'this fork';
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

/** What to call the session tab: plain, or named after the fork or subagent. */
export function sessionTabLabel(view: ViewedSession): string {
  if (view.isSubagentView) return `Session · ${subagentLabel(view.subagent)}`;
  if (view.isSideSession) return `Session · ${sessionOriginLabel(view.viewed || { kind: 'btw' })}`;
  return 'Session';
}
