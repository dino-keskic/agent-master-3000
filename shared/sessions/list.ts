import { calendarWindowStarts } from '../spend/calendar.js';
import { markdownPreview } from '../transcript/markdownPreview.js';
import { AcpSessionSummary } from './types';
import { BoardTask, TaskLogItem, TaskLogType } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
export const LIVE_SESSION_LIMIT = 8;

/**
 * Locale week start (Monday unless `locale` says otherwise), local midnight.
 *
 * Memoized on the exact arguments: the comparators below call this twice per
 * comparison, so an unmemoized sort of a few thousand sessions spends most of
 * its time re-deriving the same handful of week boundaries.
 */
const weekStartCache = new Map<string, number>();
const WEEK_START_CACHE_MAX = 4096;

export function weekStartMs(time: string | number, locale?: string, timeZone?: string): number {
  const cacheKey = `${time}\u0000${locale ?? ''}\u0000${timeZone ?? ''}`;
  const cached = weekStartCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const date = new Date(typeof time === 'number' ? time : Date.parse(time));
  const start = Number.isFinite(date.getTime())
    ? calendarWindowStarts(date.getTime(), locale, timeZone).week
    : 0;

  // Timestamps are unbounded, so the cache is bounded instead. Dropping it
  // wholesale keeps the eviction free; the next sort refills what it needs.
  if (weekStartCache.size >= WEEK_START_CACHE_MAX) weekStartCache.clear();
  weekStartCache.set(cacheKey, start);
  return start;
}

export function weekLabel(startMs: number, now = Date.now()): string {
  const thisWeek = weekStartMs(now);
  if (startMs === thisWeek) return 'This week';
  if (startMs === thisWeek - 7 * DAY_MS) return 'Last week';
  const start = new Date(startMs);
  const end = new Date(startMs + 6 * DAY_MS);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function groupSessionsByWeek(sessions: AcpSessionSummary[]): { key: number; label: string; sessions: AcpSessionSummary[] }[] {
  const groups: { key: number; label: string; sessions: AcpSessionSummary[] }[] = [];
  for (const session of sessions) {
    const key = weekStartMs(session.updatedAt);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) {
      groups.push({ key, label: weekLabel(key), sessions: [session] });
    } else {
      last.sessions.push(session);
    }
  }
  return groups;
}

function sessionWeight(session: AcpSessionSummary): number {
  if ((session.cost || 0) > 0) return session.cost as number;
  if ((session.contextTokens || 0) > 0) return (session.contextTokens as number) / 1_000_000;
  return (session.tokenCount || 0) / 1_000_000;
}

/**
 * Live folders first, then newest week, then uncommitted worktrees,
 * then most expensive / largest context, then recency.
 */
export function compareSessionOrder(a: AcpSessionSummary, b: AcpSessionSummary): number {
  const aExists = a.cwdExists !== false;
  const bExists = b.cwdExists !== false;
  if (aExists !== bExists) return aExists ? -1 : 1;

  const weekDiff = weekStartMs(b.updatedAt) - weekStartMs(a.updatedAt);
  if (weekDiff !== 0) return weekDiff;

  if (!!a.cwdDirty !== !!b.cwdDirty) return a.cwdDirty ? -1 : 1;

  const weightDiff = sessionWeight(b) - sessionWeight(a);
  if (weightDiff !== 0) return weightDiff;

  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

export function formatTokenCount(count?: number): string | undefined {
  if (!count || count <= 0) return undefined;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M tok`;
  if (count >= 1_000) return `${Math.round(count / 1_000)}k tok`;
  return `${count} tok`;
}

/**
 * A "last thing said" preview. Inline markdown is kept — the card renders it —
 * and block markup is flattened; see `shared/transcript/markdownPreview.ts`.
 */
export function clipText(text?: string, max = 160): string | undefined {
  return markdownPreview(text, max);
}

export function lastLogText(logs: TaskLogItem[] | undefined, type: TaskLogType): string | undefined {
  if (!logs) return undefined;
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    const text = log?.type === type ? log.text : undefined;
    if (text && text.trim()) return text;
  }
  return undefined;
}

/**
 * Unpinned sessions you could actually pick up: uncommitted worktrees,
 * or this week's sessions that did real work (tokens > 0). Gone folders
 * and Daily Sync-style empty chats stay out.
 */
export function isLiveSession(session: AcpSessionSummary, now = Date.now()): boolean {
  if (session.cwdExists === false) return false;
  if (session.importedAsTaskId) return false;
  if (session.cwdDirty) return true;
  if (weekStartMs(session.updatedAt) !== weekStartMs(now)) return false;
  return (session.cost || 0) > 0 || (session.contextTokens || 0) > 0 || (session.tokenCount || 0) > 0;
}

/** Dirty work first (any week), then this week, then longest. */
export function compareLiveOrder(a: AcpSessionSummary, b: AcpSessionSummary): number {
  if (!!a.cwdDirty !== !!b.cwdDirty) return a.cwdDirty ? -1 : 1;
  const weekDiff = weekStartMs(b.updatedAt) - weekStartMs(a.updatedAt);
  if (weekDiff !== 0) return weekDiff;
  const weightDiff = sessionWeight(b) - sessionWeight(a);
  if (weightDiff !== 0) return weightDiff;
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

export function pickLiveSessions(
  sessions: AcpSessionSummary[],
  limit = LIVE_SESSION_LIMIT,
  now = Date.now()
): AcpSessionSummary[] {
  return sessions.filter((session) => isLiveSession(session, now)).sort(compareLiveOrder).slice(0, limit);
}

/**
 * The two lines a card shows. Only the dedicated fields are read: the card's
 * task arrives with its transcript stripped, and the server fills these in from
 * the logs it still has before sending it.
 */
export function previewLines(task: Pick<BoardTask, 'title' | 'prompt' | 'lastMessage' | 'lastUserMessage'>): {
  user?: string;
  agent?: string;
} {
  const user = clipText(task.lastUserMessage || task.prompt, 140);
  const agent = clipText(task.lastMessage, 140);
  const title = clipText(task.title, 140);
  return {
    user: user && user !== title ? user : undefined,
    agent
  };
}
