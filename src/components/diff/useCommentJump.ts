import { useCallback, useEffect, useRef, useState } from 'react';
import { ChangelogComment } from '../../../shared/types';
import { commentRowId } from '../../../shared/review/changelogComments';

/** How long a jumped-to note stays highlighted. */
const FLASH_MS = 1_800;

/** Frames to wait for a row that a collapsed file has yet to render. */
const MAX_WAIT_FRAMES = 30;

/**
 * Getting to a review note.
 *
 * Dropping someone into the middle of a 45,000px diff with no marker leaves
 * them hunting for the note they just clicked, so an arrival flashes. The
 * scroll waits for the row to exist: expanding a collapsed file is a React
 * render away, and scrolling on the next frame would land on nothing.
 */
export interface CommentJump {
  focusedId: string | null;
  jumpTo: (commentId: string) => void;
}

export function useCommentJump(
  comments: ChangelogComment[],
  expand: (path: string, cwd?: string) => void,
  /** True once there is a diff on screen for a note to be found in. */
  ready: boolean
): CommentJump {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const jumpTo = useCallback((commentId: string) => {
    const target = comments.find((comment) => comment.id === commentId);
    if (target) expand(target.path, target.cwd);
    setFocusedId(commentId);

    const scrollWhenReady = (attempt: number) => {
      const row = document.getElementById(commentRowId(commentId));
      if (row) {
        row.scrollIntoView({ block: 'center' });
        return;
      }
      if (attempt < MAX_WAIT_FRAMES) window.requestAnimationFrame(() => scrollWhenReady(attempt + 1));
    };
    window.requestAnimationFrame(() => scrollWhenReady(0));
  }, [comments, expand]);

  useEffect(() => {
    if (!focusedId) return;
    const handle = window.setTimeout(() => setFocusedId(null), FLASH_MS);
    return () => window.clearTimeout(handle);
  }, [focusedId]);

  // Opening the tab lands on the note still waiting for an answer. Keyed on the
  // note itself, not on the diff: a background refresh replaces the diff, and
  // re-scrolling on every one would yank the page while it is being read. A
  // deliberate jump from the index wins over this opening one.
  const openId = comments.find((comment) => !comment.resolvedAt)?.id;
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !openId || focusedId) return;
    if (scrolledTo.current === openId) return;
    const handle = window.setTimeout(() => {
      const row = document.getElementById(commentRowId(openId));
      if (!row) return;
      scrolledTo.current = openId;
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
    return () => window.clearTimeout(handle);
  }, [ready, openId, focusedId]);

  return { focusedId, jumpTo };
}
