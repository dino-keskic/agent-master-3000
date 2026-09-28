import test from 'node:test';
import assert from 'node:assert';
import {
  calendarWindowStarts,
  localDateFromKey,
  localDateKey,
  spendReadFrom,
  weekStartDay
} from '../../../shared/spend/calendar.js';
import { summarizeSpend } from '../../../shared/spend/summary.js';
import { localAt, message } from '../../fixtures/spend.js';

test('Spend calendar', async (t) => {
  await t.test('window starts are calendar boundaries in local time, week following the locale', () => {
    // Wednesday 2026-01-14, 15:30 local.
    const now = localAt(2026, 0, 14, 15) + 30 * 60_000;
    const starts = calendarWindowStarts(now, 'de-DE');
    assert.strictEqual(localDateKey(starts.today), '2026-01-14');
    assert.strictEqual(localDateKey(starts.week), '2026-01-12');
    assert.strictEqual(localDateKey(starts.month), '2026-01-01');
    assert.strictEqual(new Date(starts.today).getHours(), 0);

    // A Sunday belongs to the week behind it when the week starts Monday.
    assert.strictEqual(localDateKey(calendarWindowStarts(localAt(2026, 0, 18), 'de-DE').week), '2026-01-12');
    // en-US starts Sunday, so that Sunday is the start of its own week.
    assert.strictEqual(localDateKey(calendarWindowStarts(localAt(2026, 0, 18), 'en-US').week), '2026-01-18');
    assert.strictEqual(weekStartDay('de-DE'), 1);
    assert.strictEqual(weekStartDay('en-US'), 0);
    assert.strictEqual(weekStartDay('en-US', 'America/New_York'), 0);
    assert.strictEqual(weekStartDay('en-US', 'Europe/Vienna'), 1, 'English UI in Europe still starts Monday');
  });

  await t.test('a week that began last month is still this week on the 1st', () => {
    // Tuesday 1 Sep 2026; Monday-first week starts 31 Aug.
    const now = localAt(2026, 8, 1, 15);
    const starts = calendarWindowStarts(now, 'de-DE');
    assert.strictEqual(localDateKey(starts.week), '2026-08-31');
    assert.strictEqual(localDateKey(starts.month), '2026-09-01');
    // A week further back than the window reported on, so "vs last week" has rows.
    assert.strictEqual(localDateKey(spendReadFrom(starts)), '2026-08-24');

    const summary = summarizeSpend(
      [
        message({ at: localAt(2026, 7, 31, 9), cost: 5 }),
        message({ at: localAt(2026, 8, 1, 9), cost: 3 })
      ],
      now,
      'de-DE'
    );
    assert.strictEqual(summary.today.cost, 3);
    assert.strictEqual(summary.week.cost, 8, 'Monday 31 Aug is this week, not last month leftover');
    assert.strictEqual(summary.month.cost, 3);
  });

  await t.test('a day key round-trips through local midnight, never UTC', () => {
    const at = localAt(2026, 0, 4, 23);
    assert.strictEqual(localDateKey(localDateFromKey(localDateKey(at))), '2026-01-04');
    assert.strictEqual(new Date(localDateFromKey('2026-01-04')).getHours(), 0);
  });
});
