import { AcpSessionSummary } from './types.js';
import { isLiveSession } from './list.js';

/**
 * Narrowing the OpenCode session list down to what is worth importing.
 *
 * The server hands back every session it can see, which is far more than
 * anyone wants to read. The tabs and the sort order are what makes that list
 * usable, and both are decided here so the modal only has to render them.
 */

export type SessionFilterTab = 'all' | 'live' | 'worktrees' | 'diff' | 'unimported' | 'imported';
export type SessionSortOption = 'recent' | 'tokens' | 'cost' | 'changes';

/** Lines written or deleted in the session's directory, uncommitted work included. */
function changeWeight(session: AcpSessionSummary): number {
  const summary = session.changeSummary;
  return (summary?.additions || 0) + (summary?.deletions || 0) + (session.cwdDirty ? 50 : 0);
}

function hasChanges(session: AcpSessionSummary): boolean {
  const summary = session.changeSummary;
  return !!session.cwdDirty || !!summary && (summary.additions > 0 || summary.deletions > 0);
}

export function matchesTab(session: AcpSessionSummary, tab: SessionFilterTab, now = Date.now()): boolean {
  switch (tab) {
    // Dirty counts as live: someone was working here, whatever the clock says.
    case 'live': return isLiveSession(session, now) || !!session.cwdDirty;
    case 'worktrees': return !!session.isWorktree;
    case 'diff': return hasChanges(session);
    case 'unimported': return !session.importedAsTaskId;
    case 'imported': return !!session.importedAsTaskId;
    case 'all': return true;
  }
}

export function filterSessions(
  sessions: AcpSessionSummary[],
  tab: SessionFilterTab,
  now = Date.now()
): AcpSessionSummary[] {
  return sessions.filter((session) => matchesTab(session, tab, now));
}

/** A new array, sorted. The caller's list is left alone. */
export function sortSessions(sessions: AcpSessionSummary[], sortBy: SessionSortOption): AcpSessionSummary[] {
  const list = [...sessions];
  switch (sortBy) {
    case 'tokens': return list.sort((a, b) => (b.tokenCount || 0) - (a.tokenCount || 0));
    case 'cost': return list.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    case 'changes': return list.sort((a, b) => changeWeight(b) - changeWeight(a));
    case 'recent': return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }
}

export type SessionTabCounts = Record<SessionFilterTab, number>;

/** How many sessions each tab would show, for the badges on the tabs. */
export function sessionTabCounts(sessions: AcpSessionSummary[], now = Date.now()): SessionTabCounts {
  const counts: SessionTabCounts = { all: 0, live: 0, worktrees: 0, diff: 0, unimported: 0, imported: 0 };
  for (const session of sessions) {
    for (const tab of Object.keys(counts) as SessionFilterTab[]) {
      if (matchesTab(session, tab, now)) counts[tab]++;
    }
  }
  return counts;
}
