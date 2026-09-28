/**
 * Spend rows off OpenCode's `message` table, understood: which ones are spend at
 * all, what each turn processed, and which rows are the same turn copied into a
 * fork. Everything downstream sums `SpendMessage[]`; this is where it comes from.
 */

import { turnAttributionFromMessage } from '../turns/attribution.js';

/** One assistant turn, reduced to the fields spend reporting groups by. */
export interface SpendMessage {
  sessionId: string;
  /** Epoch ms from `message.time_created` — the column the message index is built on. */
  at: number;
  cost: number;
  /** Prompt + completion + reasoning + cache reads and writes — everything the turn processed. */
  tokens: number;
  /** The `message` row's id; the last tie-break between copies of one turn. */
  messageId?: string;
  /** When the session holding this row was created. A copy's session is younger than the original's. */
  sessionCreatedAt?: number;
  /** What a copy of this turn keeps; see `copiedTurnKey`. Absent when the turn has no timestamps to go on. */
  copyKey?: string;
  model?: string;
  agent?: string;
  /** Board project the session's directory resolved to. */
  project?: string;
  /** The session's own title, carried so the session ranking can name its rows. */
  sessionTitle?: string;
}

/** A `message` row as it comes off the DB, before it is understood. */
export interface SpendMessageRow {
  sessionId: string;
  messageId?: string;
  sessionCreatedAt?: number;
  at: number;
  /** The row's `data` column: OpenCode's message JSON. */
  data: string;
  project?: string;
  sessionTitle?: string;
}

/** Money is summed as float; six places is past the cent and short of the noise. */
export function roundUsd(cost: number): number {
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * One row's spend, or nothing. Only assistant messages carry cost — user turns,
 * summaries and tool rows would otherwise inflate the message counts.
 */
export function parseSpendMessage(row: SpendMessageRow): SpendMessage | undefined {
  let data: unknown;
  try {
    data = JSON.parse(row.data);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== 'object') return undefined;
  const message = data as { role?: unknown; cost?: unknown; tokens?: unknown };
  if (message.role !== 'assistant') return undefined;

  const count = (value: unknown) => Number(value) || 0;
  const cost = count(message.cost);
  const tokens = (message.tokens && typeof message.tokens === 'object' ? message.tokens : {}) as Record<string, unknown>;
  const cache = (tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}) as Record<string, unknown>;
  // Cached input counts. It is billed, it is what the turn actually processed,
  // and leaving it out is what made a $9 session read as 400k tokens — a rate
  // of $22 per million, which is not a price anybody charges. The cache is
  // re-read every turn, so the sum is far larger than the conversation is long;
  // that is the honest number, and it is the one other OpenCode tools report.
  const counted = count(tokens.input)
    + count(tokens.output)
    + count(tokens.reasoning)
    + count(cache.read)
    + count(cache.write);
  if (cost <= 0 && counted <= 0) return undefined;

  const attribution = turnAttributionFromMessage(message);
  return {
    sessionId: row.sessionId,
    at: row.at,
    cost,
    tokens: counted,
    messageId: row.messageId,
    sessionCreatedAt: row.sessionCreatedAt,
    copyKey: copiedTurnKey(data as Record<string, unknown>),
    model: attribution.model,
    agent: attribution.agent,
    project: row.project,
    sessionTitle: row.sessionTitle
  };
}

/**
 * What stays the same when a turn is copied into another session.
 *
 * A fork — OpenCode's own, and the board's side chats and folder handoffs
 * (`server/opencode/clone.ts`) alike — writes the parent's messages into the
 * new session with their original `time_created`, `cost` and tokens. Only the
 * ids and the `parentID` pointer change. Read naively, every fork bills its
 * whole conversation a second time in whatever window that conversation
 * happened.
 *
 * The key is the turn's own record of when it ran, what it cost and what it
 * processed, on which model: two genuine turns do not start and finish in the
 * same milliseconds with the same token counts. A turn without both
 * timestamps gets no key and is never merged — undercounting a real turn is
 * worse than a rare double count.
 */
export function copiedTurnKey(data: Record<string, unknown>): string | undefined {
  const time = (data.time && typeof data.time === 'object' ? data.time : {}) as Record<string, unknown>;
  if (typeof time.created !== 'number' || typeof time.completed !== 'number') return undefined;
  return JSON.stringify([
    time.created,
    time.completed,
    data.cost ?? null,
    data.tokens ?? null,
    data.providerID ?? null,
    data.modelID ?? null
  ]);
}

/**
 * Each turn once, however many sessions hold a copy of it.
 *
 * The copy kept is the one in the oldest session: a fork is always created
 * after the turns it copies, so that is the session the turn was actually
 * spent in — its project and title are the ones the rankings should show.
 * When the original has been deleted, the oldest surviving copy stands in.
 *
 * Not the lowest message id, though OpenCode's ids ascend with time: they hold
 * only 48 bits of `ms * 0x1000`, so they wrap every 795 days (last on
 * 14 Aug 2026), and a fork made after a wrap has the *lower* ids.
 *
 * Returns the same array when there is nothing to drop.
 */
export function dropCopiedTurns(messages: SpendMessage[]): SpendMessage[] {
  const kept = new Map<string, SpendMessage>();
  let copies = 0;
  for (const message of messages) {
    if (!message.copyKey) continue;
    const seen = kept.get(message.copyKey);
    if (!seen) {
      kept.set(message.copyKey, message);
      continue;
    }
    copies += 1;
    if (isOlderCopy(message, seen)) kept.set(message.copyKey, message);
  }
  if (copies === 0) return messages;
  return messages.filter((message) => !message.copyKey || kept.get(message.copyKey) === message);
}

function isOlderCopy(a: SpendMessage, b: SpendMessage): boolean {
  const aCreated = a.sessionCreatedAt ?? Infinity;
  const bCreated = b.sessionCreatedAt ?? Infinity;
  if (aCreated !== bCreated) return aCreated < bCreated;
  return (a.messageId ?? '\uffff') < (b.messageId ?? '\uffff');
}
