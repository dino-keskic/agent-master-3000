import test from 'node:test';
import assert from 'node:assert';
import { elapsedCalendarDays } from '../../../shared/spend/calendar.js';
import {
  applySpendHistory,
  currentMonthDailyAverage,
  monthlyDailyAverages,
  recentWeekRanges,
  weeklyAverage,
  weeklySpendAverages,
  weeksInside
} from '../../../shared/spend/history.js';
import { windowDailyAverage, windowFor } from '../../../shared/spend/summary.js';
import { localAt, message } from '../../fixtures/spend.js';

test('Spend history', async (t) => {
  await t.test('a day average divides by elapsed calendar days, a full month by its length', () => {
    const now = localAt(2026, 1, 10, 15);
    assert.strictEqual(elapsedCalendarDays(localAt(2026, 1, 1, 0), now), 10);
    const month = windowFor(
      [message({ at: localAt(2026, 1, 3, 9), cost: 20 })],
      localAt(2026, 1, 1, 0),
      now
    );
    assert.deepStrictEqual(windowDailyAverage(month, now), { perDay: 2, days: 10 });
    assert.deepStrictEqual(currentMonthDailyAverage(month, now), {
      month: '2026-02',
      cost: 20,
      avgPerDay: 2,
      days: 10
    });

    const past = monthlyDailyAverages(
      [
        message({ at: localAt(2026, 0, 15, 9), cost: 31 }),
        message({ at: localAt(2026, 1, 3, 9), cost: 20 })
      ],
      now,
      1
    );
    assert.deepStrictEqual(past, [{ month: '2026-01', cost: 31, avgPerDay: 1, days: 31 }]);
  });

  await t.test('weeks follow the locale, and a week the read does not cover is dropped', () => {
    const now = localAt(2026, 0, 14, 15);
    const ranges = recentWeekRanges(now, 2, 'de-DE');
    assert.deepStrictEqual(
      ranges.map((range) => [range.key, range.days, range.partial]),
      [
        ['2026-01-05', 7, false],
        ['2026-01-12', 3, true]
      ]
    );

    const weeks = weeklySpendAverages(
      [
        message({ at: localAt(2026, 0, 6, 9), cost: 10 }),
        message({ at: localAt(2026, 0, 14, 9), cost: 4 }),
        message({ at: localAt(2025, 11, 30, 9), cost: 99 })
      ],
      now,
      2,
      'de-DE'
    );
    assert.deepStrictEqual(
      weeks.map((week) => [week.week, week.cost, week.partial]),
      [
        ['2026-01-05', 10, false],
        ['2026-01-12', 4, true]
      ]
    );
    assert.deepStrictEqual(
      weeksInside(weeks, localAt(2026, 0, 12, 0)).map((week) => week.week),
      ['2026-01-12']
    );
  });

  await t.test('the weekly average skips the open week, and paces off the month when none have finished', () => {
    const now = localAt(2026, 0, 14, 15);
    const month = windowFor([], localAt(2026, 0, 1, 0), now);
    const mean = weeklyAverage(
      [
        { week: '2026-01-05', cost: 10, days: 7, partial: false },
        { week: '2026-01-12', cost: 4, days: 3, partial: true },
        { week: '2025-12-29', cost: 30, days: 7, partial: false }
      ],
      month,
      now
    );
    assert.deepStrictEqual(mean, { perWeek: 20, weeks: 2, paced: false });

    const paced = weeklyAverage(
      [{ week: '2026-01-01', cost: 4, days: 2, partial: true }],
      { from: localAt(2026, 0, 1, 0), to: localAt(2026, 0, 2, 12), cost: 14 },
      localAt(2026, 0, 2, 12)
    );
    assert.deepStrictEqual(paced, { perWeek: 49, weeks: 0, paced: true });
  });

  await t.test('history keeps the fresh open week and the fresh current month', () => {
    const summary = {
      monthly: [{ month: '2026-01', cost: 10, avgPerDay: 1, days: 10 }],
      weekly: [{ week: '2026-01-12', cost: 4, days: 3, partial: true }]
    };
    const next = applySpendHistory(
      summary,
      [{ month: '2025-12', cost: 31, avgPerDay: 1, days: 31 }],
      [
        { week: '2026-01-05', cost: 10, days: 7, partial: false },
        { week: '2026-01-12', cost: 99, days: 3, partial: true }
      ]
    );
    assert.deepStrictEqual(
      next.monthly.map((month) => month.month),
      ['2025-12', '2026-01']
    );
    assert.deepStrictEqual(
      next.weekly.map((week) => [week.week, week.cost]),
      [
        ['2026-01-05', 10],
        ['2026-01-12', 4]
      ]
    );
  });
});
