/**
 * Board-wide spend: what a window cost, what it compares against, and where the
 * money went — by model, project, agent and session — for the Spend panel's
 * tiles, bars and day chart. The SQLite reads live in server/opencode/spend.ts,
 * so the bucketing rules here stay testable against a handful of synthetic rows.
 */

import { SpendBucket, SpendSessionRow, SpendSummary, SpendWindow } from './types.js';
import { shortModelLabel } from '../format.js';
import { calendarWindowStarts, elapsedCalendarDays, localDateKey, shiftDays } from './calendar.js';
import { SpendMessage, roundUsd } from './messages.js';

/** Work that matched no board project. */
export const OTHER_PROJECT = 'Other';

const UNKNOWN_MODEL = 'unknown';
const UNKNOWN_AGENT = 'unknown';

/**
 * One window's totals. Turns and sessions are counted here rather than derived
 * from the breakdowns: the tiles say "11 turns · 3 sessions" for a window the
 * model ranking does not cover (today), and a session spanning midnight must
 * count once in each window it spent in.
 */
export function windowFor(messages: SpendMessage[], from: number, to: number): SpendWindow {
  let cost = 0;
  let tokens = 0;
  let count = 0;
  const sessions = new Set<string>();
  for (const message of messages) {
    if (message.at < from || message.at >= to) continue;
    cost += message.cost;
    tokens += message.tokens;
    count += 1;
    sessions.add(message.sessionId);
  }
  return { from, to, cost: roundUsd(cost), tokens, messages: count, sessions: sessions.size };
}

/**
 * The same slice of an earlier period — Monday-to-now last week, against
 * Monday-to-now this week. Comparing a part week against a whole one would
 * report a fall every Monday morning.
 */
export function priorWindow(messages: SpendMessage[], window: SpendWindow, days: number): SpendWindow {
  return windowFor(messages, shiftDays(window.from, -days), shiftDays(window.to, -days));
}

/**
 * Percent change against the earlier window, rounded. Undefined when there is
 * nothing to compare against: "up ∞%" from a zero baseline says nothing.
 */
export function spendDeltaPct(current: number, previous: number): number | undefined {
  if (!previous || previous <= 0 || !Number.isFinite(current)) return undefined;
  return Math.round(((current - previous) / previous) * 100);
}

/** What a window's tokens cost per million — the unit price the tiles quote. */
export function costPerMillionTokens(window: SpendWindow): number | undefined {
  if (!window.tokens || window.tokens <= 0 || window.cost <= 0) return undefined;
  return roundUsd((window.cost / window.tokens) * 1_000_000);
}

/** What a window averaged per elapsed calendar day, and how many days that is. */
export function windowDailyAverage(window: SpendWindow, now: number): { perDay: number; days: number } {
  const days = elapsedCalendarDays(window.from, now);
  return { perDay: roundUsd(window.cost / days), days };
}

/**
 * A bar's width as a share of the largest row, 0-100.
 *
 * A breakdown reads as a ranking, so rows are measured against the top row and
 * not against the total: shares of a total turn a long tail of models into a
 * column of slivers. Anything that spent at all keeps a visible stub.
 */
export function barPct(cost: number, top: number): number {
  if (!(top > 0) || !(cost > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round((cost / top) * 100)));
}

/** Highest cost first; the label breaks ties so equal rows keep a stable order. */
function compareBuckets(a: SpendBucket, b: SpendBucket): number {
  if (b.cost !== a.cost) return b.cost - a.cost;
  return a.label.localeCompare(b.label);
}

function groupBy(
  messages: SpendMessage[],
  keyOf: (message: SpendMessage) => string,
  labelOf: (key: string) => string
): SpendBucket[] {
  const byKey = new Map<string, SpendBucket>();
  for (const message of messages) {
    const key = keyOf(message);
    const bucket = byKey.get(key) || { key, label: labelOf(key), cost: 0, tokens: 0, messages: 0 };
    bucket.cost += message.cost;
    bucket.tokens = (bucket.tokens || 0) + message.tokens;
    bucket.messages = (bucket.messages || 0) + 1;
    byKey.set(key, bucket);
  }
  return [...byKey.values()]
    .map((bucket) => ({ ...bucket, cost: roundUsd(bucket.cost) }))
    .sort(compareBuckets);
}

/** Spend by model, highest first; turns with no model recorded group as "Unknown model". */
export function spendByModel(messages: SpendMessage[]): SpendBucket[] {
  return groupBy(messages, (message) => message.model || UNKNOWN_MODEL, (key) =>
    key === UNKNOWN_MODEL ? 'Unknown model' : shortModelLabel(key)
  );
}

/** Spend by agent, highest first; turns with no agent recorded group as "Unknown agent". */
export function spendByAgent(messages: SpendMessage[]): SpendBucket[] {
  return groupBy(messages, (message) => message.agent || UNKNOWN_AGENT, (key) =>
    key === UNKNOWN_AGENT ? 'Unknown agent' : key
  );
}

/** How many sessions the "most expensive sessions" table shows. */
export const TOP_SESSION_LIMIT = 8;

/**
 * The costliest sessions of a window, highest first.
 *
 * A session's model is the one that spent the most in it, not the last one
 * seen: a turn switched to a cheap model at the end must not relabel the row
 * that an expensive model ran up. Untitled sessions fall back to their id so
 * the row is still identifiable and still clickable.
 */
export function rankSessions(
  messages: SpendMessage[],
  from: number,
  to: number,
  limit = TOP_SESSION_LIMIT
): SpendSessionRow[] {
  const rows = new Map<string, SpendSessionRow & { costByModel: Map<string, number> }>();
  for (const message of messages) {
    if (message.at < from || message.at >= to) continue;
    const row = rows.get(message.sessionId) || {
      sessionId: message.sessionId,
      title: '',
      project: message.project,
      cost: 0,
      tokens: 0,
      messages: 0,
      costByModel: new Map<string, number>()
    };
    row.title = row.title || (message.sessionTitle || '').trim();
    row.project = row.project || message.project;
    row.cost += message.cost;
    row.tokens += message.tokens;
    row.messages += 1;
    if (message.model) row.costByModel.set(message.model, (row.costByModel.get(message.model) || 0) + message.cost);
    rows.set(message.sessionId, row);
  }

  return [...rows.values()]
    .map(({ costByModel, ...row }) => ({
      ...row,
      title: row.title || row.sessionId,
      cost: roundUsd(row.cost),
      model: [...costByModel.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    }))
    .sort((a, b) => b.cost - a.cost || a.title.localeCompare(b.title))
    .slice(0, limit);
}

/** Every day of the window, oldest first, including the days nothing ran. */
export function dailySeries(messages: SpendMessage[], from: number, to: number): { date: string; cost: number }[] {
  const costByDate = new Map<string, number>();
  for (const message of messages) {
    if (message.at < from || message.at >= to) continue;
    const key = localDateKey(message.at);
    costByDate.set(key, (costByDate.get(key) || 0) + message.cost);
  }

  const series: { date: string; cost: number }[] = [];
  // Stepping a local Date by calendar days rather than by 86.4M ms keeps the
  // series aligned across a daylight-saving change.
  const cursor = new Date(from);
  while (cursor.getTime() < to) {
    const key = localDateKey(cursor.getTime());
    series.push({ date: key, cost: roundUsd(costByDate.get(key) || 0) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return series;
}

/**
 * Board-wide spend. `now` is the exclusive end of every window, so the caller
 * decides what "now" means and the result is reproducible in a test.
 *
 * History is not in here: the months and weeks behind the average tabs are
 * read on their own cadence (see `server/opencode/spend.ts`), and this only ever
 * sees the recent message list. The caller appends `monthly` and `weekly`.
 */
export function summarizeSpend(
  messages: SpendMessage[],
  now: number,
  locale?: string,
  timeZone?: string
): Omit<SpendSummary, 'generatedAt' | 'monthly' | 'weekly'> {
  const starts = calendarWindowStarts(now, locale, timeZone);
  const month = messages.filter((message) => message.at >= starts.month && message.at < now);
  const week = windowFor(messages, starts.week, now);

  return {
    today: windowFor(messages, starts.today, now),
    week,
    month: windowFor(messages, starts.month, now),
    // `spendReadFrom` reaches a week further back than the month so this has
    // rows to sum; with a narrower message list it simply reports zero.
    previousWeek: priorWindow(messages, week, 7),
    byModel: spendByModel(month),
    byProject: groupBy(month, (message) => message.project || OTHER_PROJECT, (key) => key),
    byAgent: spendByAgent(month),
    topSessions: rankSessions(month, starts.month, now),
    daily: dailySeries(month, starts.month, now)
  };
}
