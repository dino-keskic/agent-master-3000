import { DatabaseSync } from 'node:sqlite';
import { readDb } from './db.js';
import { matchProjectName } from './projects.js';
import { listChildSessionIds } from './subagents.js';
import { calendarWindowStarts, spendReadFrom } from '../../shared/spend/calendar.js';
import {
  applySpendHistory,
  currentMonthDailyAverage,
  MONTHLY_HISTORY_MONTHS,
  monthlyDailyAverages,
  pastMonthRanges,
  recentWeekRanges,
  WEEKLY_HISTORY_WEEKS,
  weeklySpendAverages,
  weeksInside
} from '../../shared/spend/history.js';
import { dropCopiedTurns, parseSpendMessage, SpendMessage } from '../../shared/spend/messages.js';
import { OTHER_PROJECT, summarizeSpend } from '../../shared/spend/summary.js';
import { phaseLabel, SpendPhase, spendSessionIds, summarizeTaskSpend } from '../../shared/spend/taskSpend.js';
import { listTaskSessions } from '../../shared/task/sessions.js';
import { sessionStages } from '../../shared/task/sessionLinks.js';
import { isCopiedSession } from '../../shared/sessions/cost.js';
import { MonthlyDailyAverage, SpendSummary, TaskSpendBreakdown, WeeklySpendAverage } from '../../shared/spend/types.js';
import { BoardColumn, BoardTask, ProjectFolder } from '../../shared/types.js';

/**
 * Spend read out of OpenCode's database.
 *
 * Two things shape every query here:
 *
 * - `message` is indexed on (session_id, time_created, id) and on nothing else,
 *   so a window query written as `WHERE time_created >= ?` full-scans 139k rows
 *   and takes four seconds. Narrowing to the sessions touched in the window
 *   first, then reading each one's messages through that index, returns the
 *   same totals in about half a second.
 * - Half a second is still far too long to pay per request, so the aggregate is
 *   cached. Nothing on the board's own hot paths reads any of this.
 */

const CACHE_TTL_MS = 60_000;

/**
 * Complete months never change — a message's cost is stored on its row, not
 * repriced — so the average-tab history reads on its own hourly cadence
 * instead of riding the 60s board refresh. The hour (rather than forever) is
 * for a database that gets pruned or backfilled underneath us.
 */
const HISTORY_TTL_MS = 3_600_000;

interface Cached<T> {
  key: string;
  at: number;
  value: T;
}

interface SpendHistory {
  pastMonths: MonthlyDailyAverage[];
  /** Finished weeks and the open one. The caller keeps its own open week. */
  weekly: WeeklySpendAverage[];
}

let boardCache: Cached<SpendSummary> | null = null;
let historyCache: Cached<SpendHistory> | null = null;
const taskCache = new Map<string, Cached<TaskSpendBreakdown>>();

function fresh<T>(entry: Cached<T> | undefined | null, key: string, now: number, ttl = CACHE_TTL_MS): T | undefined {
  if (!entry || entry.key !== key || now - entry.at > ttl) return undefined;
  return entry.value;
}

const MESSAGES_SINCE = 'SELECT id, time_created, data FROM message WHERE session_id = ? AND time_created >= ?';
const MESSAGES_ALL = 'SELECT id, time_created, data FROM message WHERE session_id = ?';

/** Every priced turn since `from`, reached through the session index rather than a table scan. */
function readMessagesSince(
  db: DatabaseSync,
  from: number,
  projects: { name: string; path: string }[]
): SpendMessage[] {
  // `title` rides along so the session ranking can name its rows without a
  // second pass over the session table.
  const sessions = db
    .prepare('SELECT id, directory, title, time_created FROM session WHERE time_updated >= ?')
    .all(from) as { id: string; directory: string | null; title: string | null; time_created: number }[];

  const statement = db.prepare(MESSAGES_SINCE);
  const messages: SpendMessage[] = [];
  for (const session of sessions) {
    const project = matchProjectName(session.directory || '', projects) || OTHER_PROJECT;
    const rows = statement.all(session.id, from) as { id: string; time_created: number; data: string }[];
    for (const row of rows) {
      const message = parseSpendMessage({
        sessionId: session.id,
        messageId: String(row.id),
        sessionCreatedAt: Number(session.time_created),
        at: Number(row.time_created),
        data: String(row.data),
        project,
        sessionTitle: session.title ? String(session.title) : undefined
      });
      if (message) messages.push(message);
    }
  }
  // A fork's copied conversation keeps its original dates and costs, and the
  // fork was updated recently, so it is read alongside the original.
  return dropCopiedTurns(messages);
}

function readMessagesFor(db: DatabaseSync, sessionIds: string[]): SpendMessage[] {
  const statement = db.prepare(MESSAGES_ALL);
  const created = db.prepare('SELECT time_created FROM session WHERE id = ?');
  const messages: SpendMessage[] = [];
  for (const sessionId of sessionIds) {
    const session = created.get(sessionId) as { time_created: number } | undefined;
    const rows = statement.all(sessionId) as { id: string; time_created: number; data: string }[];
    for (const row of rows) {
      const message = parseSpendMessage({
        sessionId,
        messageId: String(row.id),
        sessionCreatedAt: session ? Number(session.time_created) : undefined,
        at: Number(row.time_created),
        data: String(row.data)
      });
      if (message) messages.push(message);
    }
  }
  // The phases' fork bounds already leave copies out; this keeps a link that
  // lost its fork marker from billing its parent's conversation again.
  return dropCopiedTurns(messages);
}

function emptySummary(now: number, locale?: string, timeZone?: string, error?: string): SpendSummary {
  const base = summarizeSpend([], now, locale, timeZone);
  return {
    ...base,
    generatedAt: now,
    monthly: [currentMonthDailyAverage(base.month, now)],
    weekly: [],
    error
  };
}

/** The short read, plus the weeks that read actually covers and the current month. */
function withShortAverages(
  messages: SpendMessage[],
  now: number,
  locale: string | undefined,
  timeZone: string | undefined,
  from: number
): SpendSummary {
  const base = summarizeSpend(messages, now, locale, timeZone);
  return {
    ...base,
    generatedAt: now,
    monthly: [currentMonthDailyAverage(base.month, now)],
    weekly: weeksInside(weeklySpendAverages(messages, now, WEEKLY_HISTORY_WEEKS, locale, timeZone), from)
  };
}

/** Earliest instant the averages chart asks about: five months back, or eight weeks. */
function historyFrom(now: number, locale?: string, timeZone?: string): number {
  const weekFrom = recentWeekRanges(now, WEEKLY_HISTORY_WEEKS, locale, timeZone)[0]?.from ?? now;
  const monthFrom = pastMonthRanges(now, MONTHLY_HISTORY_MONTHS)[0]?.from ?? now;
  return Math.min(weekFrom, monthFrom);
}

/**
 * Past months and recent weeks. Cached for an hour, and not on the board-load
 * path: the header only needs this week, and this read walks every session
 * touched in the last five months.
 *
 * A failure is `undefined` and is not cached — an empty chart for an hour
 * would hide a database that was only briefly locked.
 */
function readSpendHistory(
  db: DatabaseSync,
  projects: { name: string; path: string }[],
  now: number,
  locale?: string,
  timeZone?: string
): SpendHistory | undefined {
  const from = historyFrom(now, locale, timeZone);
  const key = `${from}|${locale || ''}|${timeZone || ''}`;
  const cached = fresh(historyCache, key, now, HISTORY_TTL_MS);
  if (cached) return cached;

  try {
    const messages = readMessagesSince(db, from, projects);
    const value: SpendHistory = {
      pastMonths: monthlyDailyAverages(messages, now, MONTHLY_HISTORY_MONTHS),
      weekly: weeklySpendAverages(messages, now, WEEKLY_HISTORY_WEEKS, locale, timeZone)
    };
    historyCache = { key, at: now, value };
    return value;
  } catch (e) {
    console.warn('[OpenCode DB] spend history failed:', e);
    return undefined;
  }
}

/**
 * Board-wide spend for today, this week and this month.
 *
 * The read starts at whichever bound is earlier: the week can begin in the
 * previous month (Tuesday 1 Sep, week from Monday 31 Aug).
 *
 * `history` adds the hourly read behind the average tabs — past months and
 * recent weeks. The board load omits it: that read is heavier, and the header
 * only needs this week's total. The open week on a history hit still comes
 * from this minute-long read, so the tab and the week tile do not drift apart.
 */
export function boardSpend(
  projects: ProjectFolder[],
  now = Date.now(),
  locale?: string,
  timeZone?: string,
  options?: { history?: boolean }
): SpendSummary {
  const scope = projects.map((project) => ({ name: project.name, path: project.path }));
  const starts = calendarWindowStarts(now, locale, timeZone);
  const from = spendReadFrom(starts);
  const key = `${from}|${starts.month}|${locale || ''}|${timeZone || ''}|${scope.map((p) => `${p.name}:${p.path}`).join('|')}`;
  const cached = fresh(boardCache, key, now);
  if (cached && !options?.history) return cached;

  const db = readDb();
  // A history request still prefers the short snapshot we already have over an
  // error, when the database has gone away between the two reads.
  if (!db) return cached ?? emptySummary(now, locale, timeZone, 'OpenCode database not found');

  try {
    const summary = cached ?? withShortAverages(readMessagesSince(db, from, scope), now, locale, timeZone, from);
    if (!cached) boardCache = { key, at: now, value: summary };
    if (!options?.history) return summary;

    const history = readSpendHistory(db, scope, now, locale, timeZone);
    return history ? applySpendHistory(summary, history.pastMonths, history.weekly) : summary;
  } catch (e) {
    console.warn('[OpenCode DB] board spend failed:', e);
    return emptySummary(now, locale, timeZone, 'Could not read spend from the OpenCode database');
  }
}

/**
 * One phase per stage a linked session worked in, each owning its subagent tree.
 *
 * A session id is claimed by the first link that reaches it, so a tree shared by
 * two links is counted once and the phase rows still sum to the total. Within a
 * link, the stages it recorded cut its spend into consecutive stretches; a link
 * that never crossed a column is a single stretch, exactly as before.
 */
function taskPhases(task: BoardTask, columns: BoardColumn[]): SpendPhase[] {
  const claimed = new Set<string>();
  const phases: SpendPhase[] = [];

  for (const link of listTaskSessions(task)) {
    const sessionIds: string[] = [];
    for (const sessionId of [link.sessionId, ...listChildSessionIds(link.sessionId)]) {
      if (!sessionId || claimed.has(sessionId)) continue;
      claimed.add(sessionId);
      sessionIds.push(sessionId);
    }

    // A fork's copied conversation predates the link; nothing before that is
    // this task's spend, whichever stage it looks like it fell in.
    const forkedAfter = isCopiedSession(link) ? link.createdAt : undefined;
    const stages = sessionStages(link);

    if (stages.length === 0) {
      phases.push({
        key: link.sessionId,
        sessionId: link.sessionId,
        label: phaseLabel(link),
        sessionIds,
        billedAfter: forkedAfter
      });
      continue;
    }

    stages.forEach((stage, index) => {
      const columnTitle = columns.find((column) => column.id === stage.columnId)?.title;
      const next = stages[index + 1];
      // The first stretch reaches back to the start of the session (or to the
      // fork), so turns taken before the board learned of the session are still
      // billed rather than silently dropped.
      const from = index === 0 ? forkedAfter : Math.max(stage.at, forkedAfter ?? stage.at);
      phases.push({
        key: stages.length === 1 ? link.sessionId : `${link.sessionId}#${index}`,
        sessionId: link.sessionId,
        label: phaseLabel(link, columnTitle),
        // Every stretch can see the whole subagent tree; the time bounds decide
        // which stretch a subagent turn lands in.
        sessionIds,
        billedAfter: from,
        billedBefore: next?.at
      });
    });
  }

  return phases;
}

export function taskSpend(
  task: BoardTask,
  columns: BoardColumn[],
  now = Date.now(),
  options: { fresh?: boolean } = {}
): TaskSpendBreakdown {
  const phases = taskPhases(task, columns);
  // The stage bounds are part of the key: a task that moved column has the same
  // sessions but different phase rows, and must not be served the old split.
  const key = phases
    .map((phase) => `${phase.key}@${phase.billedAfter ?? ''}-${phase.billedBefore ?? ''}:${phase.sessionIds.join(',')}`)
    .join('|');
  const cached = options.fresh ? undefined : fresh(taskCache.get(task.id), key, now);
  if (cached) return cached;

  const empty: TaskSpendBreakdown = { ...summarizeTaskSpend(task.id, phases, []), generatedAt: now };
  const db = readDb();
  if (!db) return { ...empty, error: 'OpenCode database not found' };

  try {
    const messages = readMessagesFor(db, spendSessionIds(phases));
    const breakdown: TaskSpendBreakdown = {
      ...summarizeTaskSpend(task.id, phases, messages),
      generatedAt: now
    };
    taskCache.set(task.id, { key, at: now, value: breakdown });
    return breakdown;
  } catch (e) {
    console.warn('[OpenCode DB] task spend failed:', e);
    return { ...empty, error: 'Could not read spend from the OpenCode database' };
  }
}
