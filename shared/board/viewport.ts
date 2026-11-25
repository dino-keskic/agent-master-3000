/**
 * Viewport breakpoints and responsive layout rules for mobile vs desktop views.
 *
 * Kept pure in `shared/` so presentation decisions (inline sidebar vs mobile
 * drawer, back button ownership when the left rail hides) stay testable
 * outside React.
 */

/** Phones and narrow portrait viewports (matches Tailwind's `md` threshold - 1). */
export const MOBILE_BREAKPOINT_PX = 767;

/** Width below which `TaskWorkspace` hides the persistent left `WorkRail`. */
export const NARROW_WORKSPACE_PX = 899;

export type SidebarPresentation = 'hidden' | 'inline' | 'drawer';

/**
 * How the task details/sessions sidebar should be presented for the active
 * viewport. Desktop keeps its persistent resizable split sidebar (`inline`);
 * mobile phones keep transcripts full-width and raise details/sessions in a
 * slide-over drawer only when explicitly opened (`drawer`).
 */
export function sidebarPresentation(
  isMobile: boolean,
  desktopOpen: boolean,
  mobileOpen: boolean,
  disabled = false
): SidebarPresentation {
  if (disabled) return 'hidden';
  if (isMobile) return mobileOpen ? 'drawer' : 'hidden';
  return desktopOpen ? 'inline' : 'hidden';
}

/**
 * When `WorkRail` is hidden on narrow screens, the open panel's header owns the
 * Back button to return to the board.
 */
export function showBackInPanelHeader(isNarrowWorkspace: boolean): boolean {
  return isNarrowWorkspace;
}
