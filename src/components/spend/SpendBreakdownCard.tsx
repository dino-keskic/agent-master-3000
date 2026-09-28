import React from 'react';
import { SpendBucket } from '../../../shared/spend/types';
import { SpendBarRow, SpendBarTone } from './SpendBarRow';

/**
 * One breakdown card — by model, by project, by agent.
 *
 * The rows arrive already ranked from `summarizeSpend`, so this only decides
 * how many of them fit before the tail is summarised away: a card that scrolls
 * stops being a glance. Matches Agent Master 3000.dc.html (lines 1379-1407).
 */

/** Past this, the rest of the ranking says more as a count than as more rows. */
const VISIBLE_ROWS = 6;

interface SpendBreakdownCardProps {
  title: string;
  buckets: SpendBucket[];
  tone: SpendBarTone;
  /** Shown in place of the rows when the window holds nothing. */
  emptyLabel?: string;
}

export const SpendBreakdownCard: React.FC<SpendBreakdownCardProps> = ({
  title,
  buckets,
  tone,
  emptyLabel = 'Nothing in this window'
}) => {
  const shown = buckets.slice(0, VISIBLE_ROWS);
  const hidden = buckets.length - shown.length;
  // Every bar in the card is measured against the same top row, so the three
  // cards can be read side by side without their scales drifting apart.
  const top = buckets[0]?.cost || 0;

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <span className="mb-3 block font-mono text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-3">
        {title}
      </span>
      {shown.length === 0 ? (
        <span className="text-[12px] text-ink-4">{emptyLabel}</span>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((bucket) => (
            <SpendBarRow key={bucket.key} bucket={bucket} top={top} tone={tone} />
          ))}
          {hidden > 0 && (
            <span className="font-mono text-[10px] text-ink-4">
              +{hidden} more below the top {VISIBLE_ROWS}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
