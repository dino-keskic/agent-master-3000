import React from 'react';
import { Tooltip } from '@mantine/core';
import { localDateFromKey } from '../../../shared/spend/calendar';
import { formatUsd } from '../../../shared/sessions/cost';

/**
 * The month as a column per day.
 *
 * Days that ran nothing keep a hairline stub rather than disappearing: a gap
 * in the row is the point — it is how a quiet weekend reads. Matches
 * Agent Master 3000.dc.html (lines 1344-1375).
 */

const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

export const SpendDayChart: React.FC<{ daily: { date: string; cost: number }[] }> = ({ daily }) => {
  const peak = daily.reduce((max, day) => Math.max(max, day.cost), 0);
  const first = daily[0];
  const last = daily[daily.length - 1];
  if (!first || !last) return null;

  return (
    <div className="rounded-xl border border-line bg-surface-2 px-4 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
          By day
        </span>
        <span className="font-mono text-[10px] text-ink-4">
          {peak > 0 ? `peak ${formatUsd(peak) || '$0.00'}` : 'no spend this month'}
        </span>
      </div>
      <div className="spend-day-row">
        {daily.map((day) => (
          <Tooltip
            key={day.date}
            label={`${dayLabel(localDateFromKey(day.date))} · ${formatUsd(day.cost) || '$0.00'}`}
            withArrow
          >
            <div className="spend-day">
              <div
                className={`spend-day-fill${day.cost > 0 ? '' : ' is-empty'}`}
                style={{
                  height: peak > 0 ? `${Math.max(day.cost > 0 ? 4 : 2, (day.cost / peak) * 100)}%` : '2px'
                }}
              />
            </div>
          </Tooltip>
        ))}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="font-mono text-[10px] text-ink-4">{dayLabel(localDateFromKey(first.date))}</span>
        <span className="font-mono text-[10px] text-ink-4">{dayLabel(localDateFromKey(last.date))}</span>
      </div>
    </div>
  );
};
