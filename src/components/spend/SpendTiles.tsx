import React from 'react';
import { SpendSummary } from '../../../shared/spend/types';
import { costPerMillionTokens, spendDeltaPct } from '../../../shared/spend/summary';
import { formatCompactCount, formatUsd } from '../../../shared/sessions/cost';

/**
 * The four figures the spend screen opens with: month, week, today, and what a
 * million tokens is costing.
 *
 * The month tile carries the accent border — it is the number the user came for
 * — and every other tile is the context that makes it mean something. Matches
 * Agent Master 3000.dc.html (lines 1320-1343).
 */

const dayLabel = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const money = (cost: number) => formatUsd(cost) || '$0.00';

interface TileProps {
  label: string;
  value: string;
  footer: string;
  /** The headline tile: bigger, and the only one the accent border is spent on. */
  lead?: boolean;
}

const Tile: React.FC<TileProps> = ({ label, value, footer, lead }) => (
  <div
    className={`flex flex-col gap-1 rounded-xl border bg-surface-2 p-4 ${
      lead ? 'border-acc-bd' : 'border-line'
    }`}
  >
    <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-ink-3">{label}</span>
    <span
      className={`font-mono tabular-nums leading-tight ${
        lead ? 'text-[28px] font-bold text-ink' : 'text-[22px] font-semibold text-ink-2'
      }`}
    >
      {value}
    </span>
    <span className="font-mono text-[10px] text-ink-4">{footer}</span>
  </div>
);

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
      <Tile
        lead
        label="This month"
        value={money(summary.month.cost)}
        footer={`since ${dayLabel(summary.month.from)}`}
      />
      <Tile
        label="This week"
        value={money(summary.week.cost)}
        footer={
          delta == null
            ? `since ${dayLabel(summary.week.from)}`
            : `${delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} ${Math.abs(delta)}% vs last week`
        }
      />
      <Tile
        label="Today"
        value={money(summary.today.cost)}
        footer={activityLabel(summary.today.messages, summary.today.sessions)}
      />
      <Tile
        label="Tokens · this month"
        value={formatCompactCount(summary.month.tokens) || '0'}
        footer={perMillion ? `${money(perMillion)} per 1M` : 'no priced turns yet'}
      />
    </div>
  );
};
