import { boardDocumentTitle } from '../../../shared/notifications/notifications';

/** The tab itself: the count in its title, and whether you are looking at it. */

const BASE_TITLE = typeof document === 'undefined' ? 'Agent Master 3000' : document.title;

export function setBoardDocumentTitle(awaitingCount: number): void {
  if (typeof document === 'undefined') return;
  document.title = boardDocumentTitle(awaitingCount, BASE_TITLE);
}

export function isDocumentFocused(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible' && document.hasFocus();
}
