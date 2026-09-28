import React from 'react';
import { SpendSessionRow } from '../../../shared/spend/types';
import { shortModelLabel } from '../../../shared/format';
import { formatCompactCount, formatUsd } from '../../../shared/sessions/cost';

/**
 * Where the month actually went, session by session.
 *
 * The breakdowns above say which model and which project; this is the only
 * place that names the conversation, which is what makes a surprising month
 * actionable. Matches Agent Master 3000.dc.html (lines 1432-1455).
 */

/** Session · Model · Project · Tokens · Cost, as the design lays them out. */
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_120px_110px_80px_72px] gap-2.5 px-3.5';

export const TopSessionsTable: React.FC<{ rows: SpendSessionRow[]; windowLabel: string }> = ({
  rows,
  windowLabel
}) => (
  <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
    <div className="flex items-center gap-2.5 border-b border-hairline bg-surface px-3.5 py-2.5">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
        Most expensive sessions
      </span>
      <div className="flex-1" />
      <span className="font-mono text-[11px] text-ink-3">{windowLabel}</span>
    </div>

    <div
      className={`${COLUMNS} border-b border-hairline py-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-ink-4`}
    >
      <span>Session</span>
      <span>Model</span>
      <span>Project</span>
      <span className="text-right">Tokens</span>
      <span className="text-right">Cost</span>
    </div>

    {rows.length === 0 ? (
      <div className="px-3.5 py-4 font-mono text-[12px] text-ink-4">
        No session spent anything in this window.
      </div>
    ) : (
      rows.map((row) => (
        <div key={row.sessionId} className={`${COLUMNS} items-center border-b border-hairline py-2.5`}>
          <span className="truncate text-[13px] text-ink" title={row.title}>
            {row.title}
          </span>
          <span className="truncate font-mono text-[11px] text-ink-2" title={row.model}>
            {row.model ? shortModelLabel(row.model) : '—'}
          </span>
          <span className="truncate font-mono text-[11px] text-ink-3" title={row.project}>
            {row.project || '—'}
          </span>
          <span className="text-right font-mono text-[11px] tabular-nums text-ink-3">
            {formatCompactCount(row.tokens) || '0'}
          </span>
          <span className="text-right font-mono text-[12px] font-semibold tabular-nums text-ink">
            {formatUsd(row.cost) || '$0.00'}
          </span>
        </div>
      ))
    )}
  </div>
);
