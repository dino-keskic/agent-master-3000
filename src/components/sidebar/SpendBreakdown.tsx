import React, { useState } from 'react';
import { Popover } from '@mantine/core';
import { BarChart3 } from 'lucide-react';
import { TaskSpendBreakdown } from '../../../shared/spend/types';
import { formatCompactCount, formatUsdExact } from '../../../shared/sessions/cost';
import { defaultSpendGroup, SpendGroup, SpendRow, spendGroups, spendRows } from '../../../shared/spend/rows';
import { SegmentedControl } from '../ui';

/**
 * Spend breakdown in a floating popover anchored beside the sidebar so long
 * lists of stages, models, or agents never push Links or Location off screen.
 */

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
          <span className="font-mono text-[11px] text-ink-4">{formatCompactCount(row.tokens)}</span>
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
  const [opened, setOpened] = useState(false);
  const [picked, setPicked] = useState<SpendGroup | null>(null);
  const group = picked && groups.some((g) => g.group === picked) ? picked : defaultSpendGroup(breakdown);
  const buckets = groups.find((g) => g.group === group)?.buckets || [];
  const rows = spendRows(buckets, breakdown.total, { limit: Math.max(1, buckets.length), fold: false });

  if (groups.length === 0) return null;

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="left-start"
      offset={10}
      width={300}
      shadow="md"
      withinPortal
    >
      <Popover.Target>
        <button
          type="button"
          aria-expanded={opened}
          onClick={() => setOpened((o) => !o)}
          className={`px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 type-meta transition-colors ${
            opened ? 'bg-acc-bg text-acc-fg' : 'text-ink-3 hover:text-ink hover:bg-s3h'
          }`}
        >
          <BarChart3 className="w-3 h-3" />
          <span>Breakdown</span>
        </button>
      </Popover.Target>

      <Popover.Dropdown className="p-3 bg-surface border border-line rounded-xl">
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="type-meta uppercase tracking-[0.06em] text-ink-3 font-medium">
              Cost breakdown
            </span>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-ink">
              {formatUsdExact(breakdown.total)}
            </span>
          </div>

          {groups.length > 1 && (
            <SegmentedControl
              size="xs"
              value={group}
              onChange={setPicked}
              options={groups.map((g) => ({
                value: g.group,
                label: `${LABELS[g.group]} (${g.buckets.length})`
              }))}
            />
          )}

          <div className="max-h-64 overflow-y-auto pr-1 flex flex-col gap-2">
            {rows.map((row) => (
              <Row key={row.key} row={row} fill={FILL[group]} />
            ))}
          </div>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
};
