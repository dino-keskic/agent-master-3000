/**
 * Which rows of a long task-drawer list stay on screen before "Show more".
 *
 * A task that has been worked on for a while collects dozens of links,
 * sessions and subagents, and the sidebar turns into a scroll. Only the newest
 * few are what you are usually looking for, so the rest fold away — except
 * rows the caller says must stay (the session on screen, one still running),
 * because hiding the thing you are looking at is worse than a longer list.
 */

export interface CollapsedList<T> {
  /** The rows to show, in the order they were given. */
  visible: T[];
  /** How many rows "Show more" would add. Zero means nothing is folded. */
  hiddenCount: number;
}

export interface CollapseOptions<T> {
  /** How many of the newest rows to show. */
  limit?: number;
  /** When a row was added; rows that tie keep their list order, later = newer. */
  addedAt: (item: T) => number;
  /** Rows shown whatever their age. */
  keep?: (item: T) => boolean;
}

export const SHOW_MORE_LIMIT = 4;

export function collapseToRecent<T>(items: readonly T[], options: CollapseOptions<T>): CollapsedList<T> {
  const { limit = SHOW_MORE_LIMIT, addedAt, keep } = options;
  const all = { visible: [...items], hiddenCount: 0 };
  // A button that reveals a single row costs as much room as the row.
  if (items.length <= limit + 1) return all;

  const newest = items
    .map((item, index) => ({ index, at: addedAt(item) || 0 }))
    .sort((a, b) => b.at - a.at || b.index - a.index)
    .slice(0, limit)
    .map((entry) => entry.index);
  const shown = new Set(newest);
  items.forEach((item, index) => {
    if (keep?.(item)) shown.add(index);
  });

  const visible = items.filter((_, index) => shown.has(index));
  const hiddenCount = items.length - visible.length;
  return hiddenCount < 2 ? all : { visible, hiddenCount };
}
