import React, { useState } from 'react';
import { Tooltip } from '@mantine/core';
import { SpendSummary } from '../../../shared/spend/types';
import { localDateFromKey } from '../../../shared/spend/calendar';
import { weeklyAverage } from '../../../shared/spend/history';
import { windowDailyAverage } from '../../../shared/spend/summary';
import { formatUsdExact } from '../../../shared/sessions/cost';
import { SegmentedControl } from '../ui/SegmentedControl';

/**
 * What a day costs, and what a week costs.
 *
 * The tiles above are totals, and a total misleads when the month is only
 * half over. The tab picks the unit. Per day is this month's run rate, with
 * each past month beside it. Per week is the mean of the finished weeks —
 * the open week is drawn faded and left out, because a Tuesday is not a week.
 */

type AverageTab = 'day' | 'week';

const money = (cost: number) => formatUsdExact(cost) || '$0.00';

const monthTick = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return new Date(year || 0, (month || 1) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
};

const weekTick = (key: string) =>
  new Date(localDateFromKey(key)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

interface Bar {
  key: string;
  value: number;
  tip: string;
  tick: string;
  partial: boolean;
}

const Bars: React.FC<{ bars: Bar[] }> = ({ bars }) => {
  const peak = bars.reduce((max, bar) => Math.max(max, bar.value), 0);
  if (bars.length === 0) return null;

  return (
    <>
      <div className="spend-day-row mt-3">
        {bars.map((bar) => (
          <Tooltip key={bar.key} label={bar.tip} withArrow>
            <div className="spend-day">
              <div
                className={`spend-day-fill${bar.value > 0 ? '' : ' is-empty'}${bar.partial && bar.value > 0 ? ' is-partial' : ''}`}
                style={{
                  height: peak > 0 ? `${Math.max(bar.value > 0 ? 4 : 2, (bar.value / peak) * 100)}%` : '2px'
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex gap-0.5">
        {bars.map((bar) => (
          <span key={bar.key} className="min-w-0 flex-1 truncate text-center font-mono text-[9px] text-ink-4">
            {bar.tick}
          </span>
        ))}
      </div>
    </>
  );
};

export const SpendAverageTabs: React.FC<{ summary: SpendSummary }> = ({ summary }) => {
  const [tab, setTab] = useState<AverageTab>('day');
  const monthly = summary.monthly;
  const weeks = summary.weekly;
  const current = monthly[monthly.length - 1];
  const day = current
    ? { perDay: current.avgPerDay, days: current.days, total: current.cost }
    : { ...windowDailyAverage(summary.month, summary.generatedAt), total: summary.month.cost };
  const week = weeklyAverage(weeks, summary.month, summary.generatedAt);

  const dayBars: Bar[] = monthly.map((month) => ({
    key: month.month,
    value: month.avgPerDay,
    tick: monthTick(month.month),
    partial: false,
    tip: `${monthTick(month.month)} · ${money(month.avgPerDay)} / day · ${money(month.cost)} over ${month.days} ${month.days === 1 ? 'day' : 'days'}`
  }));

  const weekBars: Bar[] = weeks.map((entry) => ({
    key: entry.week,
    value: entry.cost,
    tick: weekTick(entry.week),
    partial: entry.partial,
    tip: entry.partial
      ? `This week, ${entry.days} ${entry.days === 1 ? 'day' : 'days'} in · ${money(entry.cost)} so far`
      : `Week of ${weekTick(entry.week)} · ${money(entry.cost)}`
  }));

  const figure = tab === 'day' ? day.perDay : week.perWeek;
  const unit = tab === 'day' ? '/ day' : '/ week';
  const footer = tab === 'day'
    ? `this month · ${day.days} ${day.days === 1 ? 'day' : 'days'} · ${money(day.total)} total`
    : week.paced
      ? "at this month's daily pace — no full week to average yet"
      : `mean of ${week.weeks} full ${week.weeks === 1 ? 'week' : 'weeks'} · this week ${money(summary.week.cost)} so far, not in the average`;

  return (
    <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          Average cost
        </span>
        <SegmentedControl
          size="xs"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'day', label: 'Per day' },
            { value: 'week', label: 'Per week' }
          ]}
        />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-mono text-[28px] font-bold tabular-nums leading-none text-ink">{money(figure)}</span>
        <span className="font-mono text-[12px] text-ink-3">{unit}</span>
      </div>
      <span className="mt-1 block font-mono text-[10px] text-ink-4">{footer}</span>
      <Bars bars={tab === 'day' ? dayBars : weekBars} />
    </div>
  );
};
