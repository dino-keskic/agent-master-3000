import React, { useState } from 'react';
import { TaskSpendBreakdown } from '../../../shared/spend/types';
import { formatCompactCount, formatUsdExact } from '../../../shared/sessions/cost';
import { defaultSpendGroup, SpendGroup, SpendRow, spendGroups, spendRows } from '../../../shared/spend/rows';
import { SegmentedControl } from '../ui';

/**
 * Where the task's money went, one split at a time: by stage, by model, by
 * agent. Three stacked lists made the sidebar a wall of small print; a switch
 * shows one, with a bar per row so the big spender is visible at a glance.
 */

/** Ranked splits past this many rows fold their tail into one. */
const VISIBLE_ROWS = 5;

const LABELS: Record<SpendGroup, string> = { phase: 'Stage', model: 'Model', agent: 'Agent' };

/** One colour per split, as the board's own spend panel paints them. */
const FILL: Record<SpendGroup, string> = { phase: 'bg-accent', model: 'bg-run', agent: 'bg-wait' };

const Row: React.FC<{ row: SpendRow; fill: string }> = ({ row, fill }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-baseline justify-between gap-2">
      <span
        className={`truncate text-[12px] ${row.folded ? 'text-ink-3' : 'text-ink-2'}`}
        title={row.label}
      >
        {row.label}
      </span>
      <span className="flex shrink-0 items-baseline gap-2">
        {row.tokens ? (
          <span className="font-mono text-[10px] text-ink-4">{formatCompactCount(row.tokens)}</span>
        ) : null}
        <span className="font-mono text-[12px] tabular-nums text-ink">{formatUsdExact(row.cost) || '$0.00'}</span>
      </span>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-s4">
      <div
        className={`h-full rounded-full ${row.folded ? 'bg-line-strong' : fill}`}
        style={{ width: `${row.share}%` }}
      />
    </div>
  </div>
);

export const SpendBreakdown: React.FC<{ breakdown: TaskSpendBreakdown }> = ({ breakdown }) => {
  const groups = spendGroups(breakdown);
  const [picked, setPicked] = useState<SpendGroup | null>(null);
  // Until the user picks, follow the data: the first split that divides the
  // money can change as a running task moves stage or model.
  const group = picked && groups.some((g) => g.group === picked) ? picked : defaultSpendGroup(breakdown);
  const buckets = groups.find((g) => g.group === group)?.buckets || [];
  const rows = spendRows(buckets, breakdown.total, { limit: VISIBLE_ROWS, fold: group !== 'phase' });

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="type-meta text-ink-3">Split by</span>
        <SegmentedControl
          size="xs"
          value={group}
          onChange={setPicked}
          options={groups.map((g) => ({ value: g.group, label: LABELS[g.group] }))}
        />
      </div>
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <Row key={row.key} row={row} fill={FILL[group]} />
        ))}
      </div>
    </div>
  );
};
