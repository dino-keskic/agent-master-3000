/**
 * What OpenCode has, as the board lists it: its sessions (for import and the
 * project session lists), the subagent tree under a linked session, and the
 * models and agents the pickers offer.
 */

import { ChangeSummary } from '../types.js';

/** An existing OpenCode session, listed from the local DB or ACP session/list. */
export interface AcpSessionSummary {
  sessionId: string;
  title: string;
  cwd: string;
  createdAt?: string;
  updatedAt: string;
  agent?: string;
  model?: string;
  changeSummary?: ChangeSummary;
  /** Git worktree (sibling `.worktrees/` or OpenCode's own worktree dir). */
  isWorktree?: boolean;
  worktreeLabel?: string;
  /** False when the session's cwd (often a worktree) has been deleted. */
  cwdExists?: boolean;
  /** Uncommitted git changes in that cwd — live work, not historical diffs. */
  cwdDirty?: boolean;
  /** Board project this session belongs to (when listing across all added projects). */
  projectName?: string;
  /** Prompt+completion+reasoning tokens — used as session "length". */
  tokenCount?: number;
  /** Estimated API USD for the root session plus its subagents. */
  cost?: number;
  /** Cost of messages that predate the session row — the parent conversation a fork inherited. */
  inheritedCost?: number;
  /** Child OpenCode sessions rolled into cost/tokenCount. */
  subagentCount?: number;
  /** Last assistant turn occupancy (input + cache + output). */
  contextTokens?: number;
  /** Context window OpenCode is using (opencode.json override, else catalog). */
  contextLimit?: number;
  /** Set by the server when a board task already tracks this session. */
  importedAsTaskId?: string;
}

export interface AcpSessionListResponse {
  sessions: AcpSessionSummary[];
  /** Root sessions matching the current filters (not counting subagents). */
  total: number;
  untitledCount: number;
}

/**
 * A child OpenCode session spawned from a linked session (`session.parent_id`).
 * Direct children only at each level; descendants nest in `children`.
 */
export interface SubagentSession {
  sessionId: string;
  parentId: string;
  title: string;
  agent?: string;
  /** `provider/model` of its latest turn, else the one the session was opened with. */
  model?: string;
  /** This session's own spend — its children have rows of their own. */
  cost?: number;
  tokenCount?: number;
  /** Own spend plus every descendant's; set only when it has children. */
  treeCost?: number;
  treeTokenCount?: number;
  /** Last-turn occupancy, and the window it is measured against. */
  contextTokens?: number;
  contextLimit?: number;
  createdAt?: string;
  updatedAt?: string;
  /** True while this child session has a turn of its own in flight. */
  running?: boolean;
  children: SubagentSession[];
}

export interface OpenCodeModel {
  id: string;
  name: string;
  provider: string;
  /**
   * The project folders this model is offered in, when it is not offered in
   * all of them — a provider from one project's `opencode.json`. Absent means
   * everywhere.
   */
  onlyIn?: string[];
  /** `onlyIn` as the pickers say it — "only in Billing API" — named by the server, which knows the projects. */
  scope?: string;
}

export interface OpenCodeAgent {
  name: string;
  description: string;
}
