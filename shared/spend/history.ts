/**
 * The averages tabs: past months and recent weeks, what each cost, and the
 * weekly mean. Read on a slower cadence than the live windows (see
 * server/opencode/spend.ts), then spliced into the summary so the open week and
 * the current month always come from the fresher read.
 */

import { MonthlyDailyAverage, SpendWindow, WeeklySpendAverage } from './types.js';
import { calendarWindowStarts, elapsedCalendarDays, localDateFromKey, localDateKey, monthKey } from './calendar.js';
import { SpendMessage, roundUsd } from './messages.js';
import { windowDailyAverage, windowFor } from './summary.js';

/** Past complete months behind the current one on the months chart. */
export const MONTHLY_HISTORY_MONTHS = 5;

/** Complete calendar months before the one `now` falls in, oldest first. */
export function pastMonthRanges(now: number, count = MONTHLY_HISTORY_MONTHS): { key: string; from: number; to: number; days: number }[] {
  const at = new Date(now);
  const ranges: { key: string; from: number; to: number; days: number }[] = [];
  for (let back = count; back >= 1; back--) {
    const first = new Date(at.getFullYear(), at.getMonth() - back, 1);
    const next = new Date(at.getFullYear(), at.getMonth() - back + 1, 1);
    ranges.push({
      key: monthKey(first.getTime()),
      from: first.getTime(),
      to: next.getTime(),
      days: new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    });
  }
  return ranges;
}

/**
 * Each past month's cost and what it averaged per day. Complete months divide
 * by their full length — a quiet February is cheap per day, not per elapsed
 * day, because every day of it has already happened.
 */
export function monthlyDailyAverages(
  messages: SpendMessage[],
  now: number,
  count = MONTHLY_HISTORY_MONTHS
): MonthlyDailyAverage[] {
  return pastMonthRanges(now, count).map((range) => {
    const window = windowFor(messages, range.from, range.to);
    return { month: range.key, cost: window.cost, avgPerDay: roundUsd(window.cost / range.days), days: range.days };
  });
}

/** The current month's entry: the same shape, divided by the days elapsed. */
export function currentMonthDailyAverage(month: SpendWindow, now: number): MonthlyDailyAverage {
  const days = elapsedCalendarDays(month.from, now);
  return { month: monthKey(month.from), cost: month.cost, avgPerDay: roundUsd(month.cost / days), days };
}

/** How many calendar weeks the averages chart looks back, including the open one. */
export const WEEKLY_HISTORY_WEEKS = 8;

export interface WeekRange {
  /** `YYYY-MM-DD` of the week's first local day. */
  key: string;
  from: number;
  /** Exclusive end. The open week ends at `now`, not at next week. */
  to: number;
  days: number;
  partial: boolean;
}

/**
 * The last `count` calendar weeks, oldest first. The week starts where the
 * locale's week starts, same as the "this week" tile, so the two cannot disagree
 * about which days belong together.
 */
export function recentWeekRanges(
  now: number,
  count = WEEKLY_HISTORY_WEEKS,
  locale?: string,
  timeZone?: string
): WeekRange[] {
  const { week } = calendarWindowStarts(now, locale, timeZone);
  const ranges: WeekRange[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const start = new Date(week);
    start.setDate(start.getDate() - back * 7);
    const from = start.getTime();
    const next = new Date(start);
    next.setDate(next.getDate() + 7);
    const partial = back === 0;
    ranges.push({
      key: localDateKey(from),
      from,
      to: partial ? now : next.getTime(),
      days: partial ? elapsedCalendarDays(from, now) : 7,
      partial
    });
  }
  return ranges;
}

/** One bar per week: what that week cost, not what it averaged. */
export function weeklySpendAverages(
  messages: SpendMessage[],
  now: number,
  count = WEEKLY_HISTORY_WEEKS,
  locale?: string,
  timeZone?: string
): WeeklySpendAverage[] {
  return recentWeekRanges(now, count, locale, timeZone).map((range) => ({
    week: range.key,
    cost: windowFor(messages, range.from, range.to).cost,
    days: range.days,
    partial: range.partial
  }));
}

/**
 * Drop weeks the message read does not cover.
 *
 * A week that started before `from` would add up as a cheap week — its first
 * days were never read — and pull the average down. The open week is kept:
 * the short read always reaches back to the week before it.
 */
export function weeksInside(weeks: WeeklySpendAverage[], from: number): WeeklySpendAverage[] {
  return weeks.filter((week) => localDateFromKey(week.week) >= from);
}

export interface WeeklyAverage {
  perWeek: number;
  /** Finished weeks in the mean. Zero when `paced` is set. */
  weeks: number;
  /**
   * No finished week to average yet, so this is the month's daily rate times
   * seven. A Tuesday is not a sample of a week.
   */
  paced: boolean;
}

/** Mean cost of the finished weeks, or the month's pace when none have finished. */
export function weeklyAverage(weeks: WeeklySpendAverage[], month: SpendWindow, now: number): WeeklyAverage {
  const complete = weeks.filter((week) => !week.partial);
  if (complete.length > 0) {
    const total = complete.reduce((sum, week) => sum + week.cost, 0);
    return { perWeek: roundUsd(total / complete.length), weeks: complete.length, paced: false };
  }
  const { perDay } = windowDailyAverage(month, now);
  return { perWeek: roundUsd(perDay * 7), weeks: 0, paced: true };
}

/**
 * Swap the short window's history for the longer read, without letting the
 * longer read's open week replace a fresher one.
 *
 * Past months and finished weeks move slowly and are cached for an hour. The
 * open week and the current month are on the minute-long read, and they are
 * the numbers sitting next to the tiles — an hour-old Tuesday must not win.
 */
export function applySpendHistory<T extends { monthly: MonthlyDailyAverage[]; weekly: WeeklySpendAverage[] }>(
  summary: T,
  pastMonths: MonthlyDailyAverage[],
  weeks: WeeklySpendAverage[]
): T {
  const currentMonth = summary.monthly[summary.monthly.length - 1];
  const currentWeek = summary.weekly.find((week) => week.partial);
  const pastWeeks = weeks.filter((week) => !week.partial);
  return {
    ...summary,
    monthly: currentMonth ? [...pastMonths, currentMonth] : pastMonths,
    weekly: currentWeek ? [...pastWeeks, currentWeek] : pastWeeks
  };
}
