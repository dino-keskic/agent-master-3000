/**
 * One task's spend, by phase: each linked session's stretches in each board
 * column, its subagents rolled in, forks' copied history left out — and the
 * per-session total the task sidebar prints from the same breakdown.
 */

import { SpendBucket, TaskSpendBreakdown } from './types.js';
import { TaskSessionLink } from '../types.js';
import { sessionOriginLabel } from '../task/sessions.js';
import { SpendMessage, roundUsd } from './messages.js';
import { spendByAgent, spendByModel } from './summary.js';

/**
 * A phase is one stretch of one linked session — plus the subagents it spawned
 * — spent in a single board column.
 *
 * A session that stays live across a stage move produces several of these, cut
 * at the moment it moved; a session that never moved produces exactly one, as
 * before. Subagent spend rolls up into whichever stretch it falls inside, so a
 * task that fanned out to eight subagents does not under-report.
 */
export interface SpendPhase {
  /** Row identity. Unique per stretch, so two stages of one session are two rows. */
  key: string;
  /** The linked session this stretch belongs to. */
  sessionId: string;
  label: string;
  /** That session and its whole subagent tree. */
  sessionIds: string[];
  /**
   * Inclusive start. Forks copy the parent conversation, so messages dated
   * before a fork are the clone, not new spend; a later stage starts where the
   * previous one ended.
   */
  billedAfter?: number;
  /** Exclusive end — set when a later stage took over this session. */
  billedBefore?: number;
}

/**
 * Every session a task's phases price, once each.
 *
 * The stages of one session are separate phase rows over the *same* sessions —
 * the session and its subagent tree — so the phase list names those ids as many
 * times as the session changed column. Reading messages per name would then
 * bill every turn once per stage, and a task that moved once would report
 * exactly twice what it spent.
 */
export function spendSessionIds(phases: SpendPhase[]): string[] {
  return [...new Set(phases.flatMap((phase) => phase.sessionIds).filter(Boolean))];
}

/** What a phase row says: where the session sits, then what it was called. */
export function phaseLabel(
  link: Pick<TaskSessionLink, 'title' | 'kind' | 'origin'>,
  columnTitle?: string
): string {
  const badge = columnTitle || sessionOriginLabel(link);
  const title = (link.title || '').trim();
  if (!title || title === badge) return badge;
  return `${badge} · ${title}`;
}

/**
 * The session a phase row belongs to. A session that crossed a column is
 * several rows — `<sessionId>#<n>` — and they are all that session's spend.
 */
export function phaseSessionId(key: string): string {
  const hash = key.indexOf('#');
  return hash === -1 ? key : key.slice(0, hash);
}

/**
 * What one linked session cost, subagents included, read out of the breakdown
 * the Spend panel is showing.
 *
 * The stats above that panel used to print a *different* measurement of the
 * same money: the `session.cost` column, refreshed on the board poll, against a
 * per-message sum refreshed every few seconds from a cache. The two agree at
 * rest and diverge wildly mid-run, which is a bug the user reads as "the board
 * cannot count". One number now, from one read.
 *
 * `undefined` — not zero — when the breakdown has no row for the session: it
 * has not been read yet, and the caller still has the task's own totals to fall
 * back on.
 */
export function sessionSpendTotal(
  breakdown: { byPhase: SpendBucket[] } | null | undefined,
  sessionId: string | undefined
): number | undefined {
  if (!breakdown || !sessionId) return undefined;
  const rows = breakdown.byPhase.filter((bucket) => phaseSessionId(bucket.key) === sessionId);
  if (rows.length === 0) return undefined;
  return roundUsd(rows.reduce((total, bucket) => total + bucket.cost, 0));
}

export function summarizeTaskSpend(
  taskId: string,
  phases: SpendPhase[],
  messages: SpendMessage[]
): Omit<TaskSpendBreakdown, 'generatedAt'> {
  // A session id no longer picks out one phase — a session that crossed a stage
  // boundary owns several, split by time — so the message's own timestamp
  // decides which stretch it belongs to.
  const phasesBySession = new Map<string, SpendPhase[]>();
  const claimed = new Set<string>();
  for (const phase of phases) {
    for (const sessionId of phase.sessionIds) {
      const key = `${phase.key}|${sessionId}`;
      if (claimed.has(key)) continue;
      claimed.add(key);
      const list = phasesBySession.get(sessionId) || [];
      list.push(phase);
      phasesBySession.set(sessionId, list);
    }
  }

  const phaseFor = (message: SpendMessage): SpendPhase | undefined =>
    phasesBySession.get(message.sessionId)?.find(
      (phase) =>
        (phase.billedAfter == null || message.at >= phase.billedAfter) &&
        (phase.billedBefore == null || message.at < phase.billedBefore)
    );

  // Only messages a phase actually bills are `owned`. Grouping the model and
  // agent rows over anything wider would make them sum past the total — the
  // conversation a fork copied in would be counted twice.
  const owned: SpendMessage[] = [];
  const byPhase = new Map<string, SpendBucket>(
    phases.map((phase) => [phase.key, { key: phase.key, label: phase.label, cost: 0, tokens: 0, messages: 0 }])
  );

  let total = 0;
  let tokens = 0;
  for (const message of messages) {
    const phase = phaseFor(message);
    if (!phase) continue;
    owned.push(message);
    total += message.cost;
    tokens += message.tokens;
    const bucket = byPhase.get(phase.key);
    if (!bucket) continue;
    bucket.cost += message.cost;
    bucket.tokens = (bucket.tokens || 0) + message.tokens;
    bucket.messages = (bucket.messages || 0) + 1;
  }

  return {
    taskId,
    total: roundUsd(total),
    tokens,
    byModel: spendByModel(owned),
    // Chronological, unlike every other breakdown here: phase rows are now
    // stretches of time, and a task's stages read as the story of the task.
    // Cost-ranking them would shuffle Execute above Plan and lose that.
    //
    // Zero rows stay: a stage that cost nothing is still part of the task, and
    // dropping it would read as spend the breakdown lost.
    byPhase: [...byPhase.values()].map((bucket) => ({ ...bucket, cost: roundUsd(bucket.cost) })),
    byAgent: spendByAgent(owned)
  };
}
