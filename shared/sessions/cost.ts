export interface TokenUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  contextLimit?: number;
}

/** Last-turn occupancy: prefer OpenCode's tokens.total, else sum the buckets. */
export function contextTokensFromUsage(tokens?: TokenUsage | null): number {
  if (!tokens) return 0;
  if (tokens.total && tokens.total > 0) return tokens.total;
  return (tokens.input || 0)
    + (tokens.output || 0)
    + (tokens.reasoning || 0)
    + (tokens.cacheRead || 0)
    + (tokens.cacheWrite || 0);
}

/**
 * Fallback estimate from list prices ($ / 1M tokens). Prefer OpenCode's
 * session.cost — cumulative token columns over-count cache across turns.
 */
export function estimateCost(usage: TokenUsage | undefined, price?: ModelPrice): number | undefined {
  if (!usage || !price) return undefined;
  const output = (usage.output || 0) + (usage.reasoning || 0);
  const usd = (
    (usage.input || 0) * price.input
    + output * price.output
    + (usage.cacheRead || 0) * (price.cacheRead || 0)
    + (usage.cacheWrite || 0) * (price.cacheWrite || 0)
  ) / 1_000_000;
  return usd > 0 ? usd : undefined;
}

/** OpenCode's session.cost is the step-sum. Do not estimate from cumulative token columns — cache is counted every turn. */
export function resolveSessionCost(storedCost: number | undefined): number | undefined {
  if (storedCost && storedCost > 0) return storedCost;
  return undefined;
}

/** A copied session starts with the parent's conversation already on the meter. */
export function isCopiedSession(link: {
  origin?: string;
  kind?: string;
  forkedFrom?: string;
}): boolean {
  return link.origin === 'fork' || link.kind === 'btw' || !!link.forkedFrom;
}

/**
 * What this session actually spent. Forks inherit the parent's OpenCode cost
 * at clone time; subtract that so a side chat is not priced as a second copy
 * of the whole conversation.
 */
export function billedSessionCost(
  link: { origin?: string; kind?: string; forkedFrom?: string; costAtFork?: number; cost?: number },
  liveCost?: number,
  inheritedCost?: number
): number {
  const raw = liveCost ?? link.cost ?? 0;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (!isCopiedSession(link)) return raw;
  const basis = link.costAtFork ?? inheritedCost ?? 0;
  return Math.max(0, raw - basis);
}

/** Task total: every linked session's billed spend, forks included. */
export function totalSessionCost(sessions: { cost?: number }[] | undefined): number | undefined {
  if (!sessions?.length) return undefined;
  let total = 0;
  for (const session of sessions) total += session.cost || 0;
  return total > 0 ? total : undefined;
}

/**
 * Nudge a breakdown's rows so the figures printed beside them add up to the
 * figure printed for their total.
 *
 * Rounding each row on its own is what made $1.73 + $1.11 + $0.11 sit under a
 * total of $2.94: the rows are right to six places and wrong to two, and the
 * only place that shows is on screen, where it reads as an accounting error.
 *
 * Largest remainder — every row rounds down, then the cents the total is short
 * go to the rows that lost the most in the rounding. Each row moves by at most
 * one cent and no row moves the wrong way.
 *
 * Always cents, so pair it with `formatUsdExact` rather than `formatUsd`:
 * a column that switched to whole dollars past $10 would print a $3.00 row
 * beside an $11 one and swallow every row under fifty cents.
 */
export function apportionUsd(costs: number[], total: number): number[] {
  const scale = 100;
  const exact = costs.map((cost) => (cost > 0 ? cost : 0) * scale);
  const units = exact.map((value) => Math.floor(value));
  const remainderAt = (index: number) => (exact[index] ?? 0) - (units[index] ?? 0);

  let short = Math.round(total * scale) - units.reduce((sum, value) => sum + value, 0);
  // Rows that lost the most to the floor are made whole first. Ties keep the
  // order the rows were given in, so the same breakdown always renders alike.
  const order = costs
    .map((_, index) => index)
    .sort((a, b) => remainderAt(b) - remainderAt(a) || a - b);

  for (let i = 0; short > 0 && i < order.length; i += 1, short -= 1) {
    const index = order[i] as number;
    units[index] = (units[index] ?? 0) + 1;
  }
  // Rows can sum past a total that was itself rounded down; take it back from
  // the rows that gained the least, and never below zero.
  for (let i = order.length - 1; short < 0 && i >= 0; i -= 1) {
    const index = order[i] as number;
    if ((units[index] ?? 0) <= 0) continue;
    units[index] = (units[index] ?? 0) - 1;
    short += 1;
  }

  return units.map((value) => value / scale);
}

/**
 * Cents, whatever the size. `formatUsd` rounds to whole dollars past $10, which
 * is right for a figure quoted on its own and wrong for a column of them that
 * has to add up.
 */
export function formatUsdExact(cost?: number): string | undefined {
  if (cost == null || !Number.isFinite(cost) || cost < 0) return undefined;
  return `$${cost.toFixed(2)}`;
}

export function formatUsd(cost?: number): string | undefined {
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return undefined;
  if (cost < 0.01) return '<$0.01';
  if (cost < 10) return `$${cost.toFixed(2)}`;
  if (cost < 100) return `$${cost.toFixed(0)}`;
  return `$${Math.round(cost)}`;
}

export function formatCompactCount(count?: number): string | undefined {
  if (!count || count <= 0) return undefined;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`;
  return String(count);
}

/** Last turn vs the model's context window, e.g. "175k / 500k". */
export function formatContext(used?: number, limit?: number): string | undefined {
  const usedLabel = formatCompactCount(used);
  if (!usedLabel) return undefined;
  const limitLabel = formatCompactCount(limit);
  return limitLabel ? `${usedLabel} / ${limitLabel}` : `${usedLabel} ctx`;
}

export function contextFillPct(used?: number, limit?: number): number | undefined {
  if (!used || !limit || limit <= 0) return undefined;
  return Math.min(100, Math.round((used / limit) * 100));
}

export type ContextTone = 'ok' | 'warn' | 'full';

/**
 * How worried the context meter should look. Past 70% a long turn can run out
 * of room; past 90% the next one likely will, and compacting is the fix.
 */
export function contextTone(pct: number | undefined): ContextTone {
  if (pct == null || pct < 70) return 'ok';
  return pct < 90 ? 'warn' : 'full';
}
