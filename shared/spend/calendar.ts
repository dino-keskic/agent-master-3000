/**
 * The calendar spend is cut by, in local time: where today, this week and this
 * month start, which weekday a week starts on, and the `YYYY-MM-DD` / `YYYY-MM`
 * keys the charts label their days and months with. No spend in here — only
 * dates, so every window and history range agrees on the same boundaries.
 */

export interface WindowStarts {
  today: number;
  week: number;
  month: number;
}

/**
 * `Date.getDay()` value the locale treats as the first day of the week.
 * Sunday = 0 … Saturday = 6. Falls back to Monday (ISO) when the locale
 * does not say — that is the usual calendar week outside the US.
 *
 * Memoized: `new Intl.Locale(...).getWeekInfo()` costs microseconds, and this
 * sits under the session-list sort comparator, which asks for it a few times
 * per comparison.
 */
const firstDayCache = new Map<string, number>();

function firstDayFromLocale(locale?: string): number {
  const cacheKey = locale ?? '';
  const cached = firstDayCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const day = computeFirstDayFromLocale(locale);
  firstDayCache.set(cacheKey, day);
  return day;
}

function computeFirstDayFromLocale(locale?: string): number {
  try {
    const tag = locale?.trim() || undefined;
    const loc = new Intl.Locale(tag || 'en-GB') as Intl.Locale & {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const info = typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo;
    const first = info?.firstDay;
    if (first == null || !Number.isFinite(first)) return 1;
    // Intl: 1 = Monday … 7 = Sunday.
    return first === 7 ? 0 : first;
  } catch {
    return 1;
  }
}

/**
 * `Date.getDay()` value the user treats as the first day of the week.
 * Sunday = 0 … Saturday = 6. Locale wins (en-US = Sunday, de-DE = Monday).
 * English UI in a European timezone still uses Monday — that is the local
 * calendar, not the Chrome language pack.
 */
export function weekStartDay(locale?: string, timeZone?: string): number {
  const fromLocale = firstDayFromLocale(locale);
  if (fromLocale === 0 && timeZone && /^Europe\//i.test(timeZone)) return 1;
  return fromLocale;
}

/**
 * Calendar boundaries in local time. A spend window has to line up with the
 * week the user thinks in — a rolling 7 days answers a different question than
 * "what have I spent this week".
 *
 * The week starts on the locale's first day (Monday in de-DE/en-GB, Sunday
 * in en-US). Unknown locales use Monday.
 */
export function calendarWindowStarts(now: number, locale?: string, timeZone?: string): WindowStarts {
  const at = new Date(now);
  const year = at.getFullYear();
  const month = at.getMonth();
  const day = at.getDate();
  const weekStartsOn = weekStartDay(locale, timeZone);
  const weekday = (at.getDay() - weekStartsOn + 7) % 7;
  return {
    today: new Date(year, month, day).getTime(),
    week: new Date(year, month, day - weekday).getTime(),
    month: new Date(year, month, 1).getTime()
  };
}

/**
 * Earliest bound a board spend read must cover.
 *
 * The week can start in the previous month (Tuesday 1 Sep, week from Monday
 * 31 Aug), and the week tile compares against the same slice of the week
 * before — so the read reaches a further seven days back than the window it
 * reports on.
 */
export function spendReadFrom(starts: WindowStarts): number {
  const weekBefore = new Date(starts.week);
  weekBefore.setDate(weekBefore.getDate() - 7);
  return Math.min(weekBefore.getTime(), starts.month);
}

/** `YYYY-MM-DD` in local time, so a day in the series is the user's day. */
export function localDateKey(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `2026-08-31` back to local midnight — the inverse of `localDateKey`.
 * `Date.parse` reads a bare date as UTC, which slides the label a day in half
 * the world's timezones.
 */
export function localDateFromKey(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year || 0, (month || 1) - 1, day || 1).getTime();
}

/** Local midnight `days` after `at`, stepped by the calendar so a DST change does not shift it. */
export function shiftDays(at: number, days: number): number {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/**
 * Calendar days from `from` through `now`, both inclusive, at least one.
 * Rounded rather than floored so a 23- or 25-hour daylight-saving day still
 * counts as one.
 */
export function elapsedCalendarDays(from: number, now: number): number {
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

/** `YYYY-MM` in local time. */
export function monthKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
