import React from 'react';
import { SpendBucket } from '../../../shared/spend/types';
import { barPct } from '../../../shared/spend/summary';
import { formatCompactCount, formatUsd } from '../../../shared/sessions/cost';

/**
 * One row of a breakdown: what it is, what it burned, and how it compares to
 * the row above it.
 *
 * The bar is a share of the *largest* row rather than of the total (`barPct`),
 * which is what keeps a long tail of models from rendering as a column of
 * identical slivers. Matches Agent Master 3000.dc.html (lines 1384-1395).
 */

/** Which token the bar is painted in — one per breakdown, as the design does. */
export type SpendBarTone = 'accent' | 'run' | 'wait';

const TONE_FILL: Record<SpendBarTone, string> = {
  accent: 'bg-accent',
  run: 'bg-run',
  wait: 'bg-wait'
};

interface SpendBarRowProps {
  bucket: SpendBucket;
  /** The top row's cost — the 100% mark every bar in the list is drawn against. */
  top: number;
  tone: SpendBarTone;
}

export const SpendBarRow: React.FC<SpendBarRowProps> = ({ bucket, top, tone }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate text-[12px] text-ink-2" title={bucket.label}>
        {bucket.label}
      </span>
      <div className="flex shrink-0 items-baseline gap-2">
        {bucket.tokens ? (
          <span className="font-mono text-[10px] text-ink-4">{formatCompactCount(bucket.tokens)}</span>
        ) : null}
        <span className="font-mono text-[12px] tabular-nums text-ink">
          {formatUsd(bucket.cost) || '$0.00'}
        </span>
      </div>
    </div>
    <div className="h-1 overflow-hidden rounded-full bg-s4">
      <div
        className={`h-full rounded-full ${TONE_FILL[tone]}`}
        style={{ width: `${barPct(bucket.cost, top)}%` }}
      />
    </div>
  </div>
);
