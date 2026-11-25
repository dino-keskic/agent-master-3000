import React from 'react';
import { SpendSummary } from '../../../shared/spend/types';
import { costPerMillionTokens, spendDeltaPct } from '../../../shared/spend/summary';
import { formatCompactCount, formatUsd } from '../../../shared/sessions/cost';
import { StatTile } from '../ui';

/**
 * The four figures the spend screen opens with: month, week, today, and what a
 * million tokens is costing.
 */

const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const money = (cost: number) => formatUsd(cost) || '$0.00';

/** "11 turns · 3 sessions", and nothing at all when neither number is known. */
function activityLabel(turns?: number, sessions?: number): string {
  const parts: string[] = [];
  if (turns) parts.push(`${turns} ${turns === 1 ? 'turn' : 'turns'}`);
  if (sessions) parts.push(`${sessions} ${sessions === 1 ? 'session' : 'sessions'}`);
  return parts.length ? parts.join(' · ') : 'nothing yet';
}

export const SpendTiles: React.FC<{ summary: SpendSummary }> = ({ summary }) => {
  const delta = spendDeltaPct(summary.week.cost, summary.previousWeek.cost);
  const perMillion = costPerMillionTokens(summary.month);

  return (
    <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        lead
        label="This month"
        value={money(summary.month.cost)}
        footer={`since ${dayLabel(summary.month.from)}`}
      />
      <StatTile
        label="This week"
        value={money(summary.week.cost)}
        footer={
          delta == null
            ? `since ${dayLabel(summary.week.from)}`
            : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} ${Math.abs(delta)}% vs last week`
        }
      />
      <StatTile
        label="Today"
        value={money(summary.today.cost)}
        footer={activityLabel(summary.today.messages, summary.today.sessions)}
      />
      <StatTile
        label="Tokens · this month"
        value={formatCompactCount(summary.month.tokens) || '0'}
        footer={perMillion ? `${money(perMillion)} per 1M` : 'no priced turns yet'}
      />
    </div>
  );
};
