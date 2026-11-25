/**
 * Pure sizing and clamping math for resizable workspace panels.
 *
 * Covers fixed-pixel side rails (the left task list and right details sidebar)
 * as well as proportional weights between split task panes, so every boundary
 * rule is tested without a DOM.
 */

export interface PanelBounds {
  min: number;
  max: number;
  defaultSize: number;
}

/** Left task list (`WorkRail`) width bounds in pixels. */
export const WORK_RAIL_BOUNDS: PanelBounds = { min: 180, max: 460, defaultSize: 272 };

/** Right details sidebar (`TaskSidebar`) width bounds in pixels. */
export const TASK_SIDEBAR_BOUNDS: PanelBounds = { min: 210, max: 520, defaultSize: 272 };

/** Studio list sidebar (`AgentsList`, `SkillsList`) width bounds in pixels. */
export const STUDIO_LIST_BOUNDS: PanelBounds = { min: 200, max: 520, defaultSize: 276 };

/** Minimum width left for the main conversation pane when resizing a side panel. */
export const MIN_MAIN_PANE_WIDTH = 320;

/** Clamp a pixel width to `bounds`, leaving room for the main pane when known. */
export function clampPanelWidth(
  value: number,
  bounds: PanelBounds,
  containerWidth?: number
): number {
  if (!Number.isFinite(value)) return bounds.defaultSize;
  const maxByContainer =
    containerWidth && Number.isFinite(containerWidth)
      ? Math.max(bounds.min, Math.floor(containerWidth - MIN_MAIN_PANE_WIDTH))
      : bounds.max;
  const upper = Math.min(bounds.max, maxByContainer);
  return Math.round(Math.min(upper, Math.max(bounds.min, value)));
}

/** Parse a persisted width from storage, falling back to `bounds.defaultSize`. */
export function parseStoredWidth(raw: string | null | undefined, bounds: PanelBounds): number {
  if (!raw) return bounds.defaultSize;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return bounds.defaultSize;
  return clampPanelWidth(parsed, bounds);
}

/**
 * Compute the next panel width during a pointer drag.
 *
 * - `'right'` edge (left rail): dragging right (+deltaX) widens the panel.
 * - `'left'` edge (right sidebar): dragging left (-deltaX) widens the panel.
 */
export function resizedWidth(
  startWidth: number,
  deltaX: number,
  edge: 'left' | 'right',
  bounds: PanelBounds,
  containerWidth?: number
): number {
  const signed = edge === 'right' ? deltaX : -deltaX;
  return clampPanelWidth(startWidth + signed, bounds, containerWidth);
}

/**
 * Keep split pane weights aligned with the current pane count.
 *
 * Returns the *same* array reference when the count already matches so callers
 * can adjust state during render without triggering an infinite loop.
 */
export function syncSplitWeights(current: readonly number[], count: number): number[] {
  if (count <= 0) return current.length === 0 ? (current as number[]) : [];
  if (current.length === count) return current as number[];
  const share = 1 / count;
  return Array.from({ length: count }, () => share);
}

/**
 * Adjust the two adjacent panes flanking `dividerIndex` by `deltaFraction`
 * (positive moves the divider right, widening the left pane and shrinking the
 * right pane) while keeping both panes at or above `minShare`.
 */
export function resizeSplitWeights(
  weights: readonly number[],
  dividerIndex: number,
  deltaFraction: number,
  minShare = 0.2
): number[] {
  if (dividerIndex < 0 || dividerIndex >= weights.length - 1) return [...weights];
  if (!Number.isFinite(deltaFraction) || deltaFraction === 0) return [...weights];

  const left = weights[dividerIndex]!;
  const right = weights[dividerIndex + 1]!;
  const pairTotal = left + right;
  const floor = Math.min(minShare, pairTotal / 2);

  const nextLeft = Math.min(pairTotal - floor, Math.max(floor, left + deltaFraction));
  const nextRight = pairTotal - nextLeft;

  return weights.map((w, i) => {
    if (i === dividerIndex) return nextLeft;
    if (i === dividerIndex + 1) return nextRight;
    return w;
  });
}
