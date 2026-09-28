import { SpendBucket, TaskSpendBreakdown } from './types.js';
import { apportionUsd } from '../sessions/cost.js';

/**
 * The rows a task's spend breakdown puts on screen.
 *
 * A breakdown in the sidebar is a glance, not a report: a long ranked tail is
 * folded into one "N more" row, and the rows are rounded so they add up to the
 * total printed above them. Phases are the exception to the folding — they
 * are the task's stages in order, and cutting the story short loses its end.
 */

export interface SpendRow {
  key: string;
  label: string;
  /** Cents, rounded so the rows add up to the total. */
  cost: number;
  tokens?: number;
  /** Share of the total, 0-100, for the bar under the row. */
  share: number;
  /** The folded tail, rather than one bucket. */
  folded?: boolean;
}

export const FOLDED_ROW_KEY = '__more';

export function spendRows(
  buckets: SpendBucket[],
  total: number,
  { limit, fold = true }: { limit: number; fold?: boolean }
): SpendRow[] {
  if (buckets.length === 0) return [];

  let rows: SpendBucket[] = buckets;
  let folded = false;
  // A single hidden row says less than the row itself, so the tail only folds
  // when it is at least two long.
  if (fold && buckets.length > limit) {
    const head = buckets.slice(0, limit - 1);
    const tail = buckets.slice(limit - 1);
    const tokens = tail.reduce((sum, bucket) => sum + (bucket.tokens || 0), 0);
    rows = [
      ...head,
      {
        key: FOLDED_ROW_KEY,
        label: `${tail.length} more`,
        cost: tail.reduce((sum, bucket) => sum + bucket.cost, 0),
        tokens: tokens || undefined
      }
    ];
    folded = true;
  }

  const shown = apportionUsd(rows.map((bucket) => bucket.cost), total);
  return rows.map((bucket, index) => ({
    key: bucket.key,
    label: bucket.label,
    cost: shown[index] ?? 0,
    tokens: bucket.tokens || undefined,
    share: sharePct(bucket.cost, total),
    ...(folded && index === rows.length - 1 ? { folded: true } : {})
  }));
}

/** A row that spent anything keeps a visible sliver of bar. */
function sharePct(cost: number, total: number): number {
  if (!(total > 0) || !(cost > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round((cost / total) * 100)));
}

export type SpendGroup = 'phase' | 'model' | 'agent';

const GROUPS: { group: SpendGroup; field: 'byPhase' | 'byModel' | 'byAgent' }[] = [
  { group: 'phase', field: 'byPhase' },
  { group: 'model', field: 'byModel' },
  { group: 'agent', field: 'byAgent' }
];

/** The ways this breakdown can be split, leaving out any with nothing in it. */
export function spendGroups(
  breakdown: Pick<TaskSpendBreakdown, 'byPhase' | 'byModel' | 'byAgent'>
): { group: SpendGroup; buckets: SpendBucket[] }[] {
  return GROUPS.map(({ group, field }) => ({ group, buckets: breakdown[field] })).filter(
    (entry) => entry.buckets.length > 0
  );
}

/**
 * The split the section opens on: the first that actually divides the money.
 * A task on one model, one agent and one stage has nothing to compare, and
 * then the stage is as good as any.
 */
export function defaultSpendGroup(
  breakdown: Pick<TaskSpendBreakdown, 'byPhase' | 'byModel' | 'byAgent'>
): SpendGroup {
  const groups = spendGroups(breakdown);
  return (groups.find((entry) => entry.buckets.length > 1) || groups[0])?.group ?? 'phase';
}
