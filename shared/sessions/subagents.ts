/**
 * Reading a subagent tree: who a child session is, and who called it.
 *
 * A subagent session has no user in it. Its opening prompt was written by the
 * session above it, so every view that shows one needs the caller's name as
 * much as the callee's.
 */

import { shortModelLabel, subagentDisplayName } from '../format.js';
import { contextFillPct, formatCompactCount, formatContext, formatUsd } from './cost.js';
import { SubagentSession } from './types.js';

export interface SubagentUsage {
  /** Short model id, e.g. `claude-haiku-4-5`. */
  model?: string;
  cost?: string;
  tokens?: string;
  /** e.g. `40k / 200k`, or `40k ctx` when the window is unknown. */
  context?: string;
  contextPct?: number;
  /** What the session cost with everything it spawned, when that differs from its own. */
  treeCost?: string;
}

/**
 * What a subagent row prints under its name. A child's own spend only: its own
 * children are the rows directly beneath it, so the rolled-up figure belongs
 * in the tooltip, where it cannot be read as a second copy of theirs.
 */
export function subagentUsage(node: SubagentSession): SubagentUsage {
  const tokens = formatCompactCount(node.tokenCount);
  const treeCost = formatUsd(node.treeCost);
  return {
    model: node.model ? shortModelLabel(node.model) : undefined,
    cost: formatUsd(node.cost),
    tokens: tokens ? `${tokens} tok` : undefined,
    context: formatContext(node.contextTokens, node.contextLimit),
    contextPct: contextFillPct(node.contextTokens, node.contextLimit),
    treeCost: treeCost && treeCost !== formatUsd(node.cost) ? treeCost : undefined
  };
}

/** The node with `sessionId`, wherever it sits in the tree. */
export function findSubagent(nodes: SubagentSession[], sessionId: string): SubagentSession | undefined {
  for (const node of nodes) {
    if (node.sessionId === sessionId) return node;
    const found = findSubagent(node.children, sessionId);
    if (found) return found;
  }
  return undefined;
}

/** Root-to-node chain, empty when the tree does not hold `sessionId`. */
export function subagentPath(nodes: SubagentSession[], sessionId: string): SubagentSession[] {
  for (const node of nodes) {
    if (node.sessionId === sessionId) return [node];
    const below = subagentPath(node.children, sessionId);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/**
 * What to call a child session on screen. `@name` in the title is what the
 * user typed to invoke it, so it wins; the `agent` column is the next best
 * thing, and a clipped title is the last resort.
 */
export function subagentLabel(node: SubagentSession | undefined): string {
  if (!node) return 'Subagent';
  const fromTitle = subagentDisplayName(node.title);
  if (fromTitle.startsWith('@')) return fromTitle;
  const agent = (node.agent || '').trim();
  if (agent) return /\s/.test(agent) ? agent : `@${agent}`;
  return fromTitle;
}

export interface SubagentCaller {
  /** The session that spawned the one being viewed. */
  sessionId: string;
  label: string;
  /** True when the caller is the task's own session rather than another subagent. */
  isRoot: boolean;
}

/**
 * Who started the session at `sessionId`. `rootLabel` names the task's own
 * session, which is where the chain ends and where a real person last typed.
 */
export function subagentCaller(
  roots: SubagentSession[],
  sessionId: string,
  rootLabel: string
): SubagentCaller | undefined {
  const path = subagentPath(roots, sessionId);
  const node = path[path.length - 1];
  if (!node) return undefined;
  const parent = path[path.length - 2];
  if (parent) return { sessionId: parent.sessionId, label: subagentLabel(parent), isRoot: false };
  return { sessionId: node.parentId, label: rootLabel, isRoot: true };
}

/**
 * The same tree, with every session the agent is currently working in flagged.
 *
 * A subagent tree is otherwise a list of things that have *happened*: the ten
 * children of a long task all look alike, and the one that is still going —
 * the only one worth opening right now — is indistinguishable from the nine
 * that finished an hour ago. `live` is the set of session ids with a turn in
 * flight; nodes are rebuilt rather than mutated so React sees the change.
 */
export function markRunningSubagents(
  nodes: SubagentSession[],
  live: ReadonlySet<string>
): SubagentSession[] {
  return nodes.map((node) => ({
    ...node,
    running: live.has(node.sessionId),
    children: markRunningSubagents(node.children, live)
  }));
}

/** How many sessions in the tree are running, at any depth. */
export function runningSubagentCount(nodes: SubagentSession[]): number {
  return nodes.reduce(
    (total, node) => total + (node.running ? 1 : 0) + runningSubagentCount(node.children),
    0
  );
}
