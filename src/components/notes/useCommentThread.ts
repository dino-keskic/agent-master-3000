import { useEffect, useState } from 'react';
import { ChangelogComment } from '../../../shared/types';

/**
 * One thread's own state: whether it is folded away, whether a reply is being
 * written, and how far along a delete is.
 */

export interface CommentThread {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  reply: string;
  setReply: (value: string) => void;
  replying: boolean;
  setReplying: (value: boolean) => void;
  busy: boolean;
  sendReply: () => Promise<void>;
  /** True once the delete has been offered and is waiting for a second click. */
  confirmDelete: boolean;
  remove: () => void;
}

export function useCommentThread(
  comment: ChangelogComment,
  focused: boolean,
  onReply: (commentId: string, body: string) => void | Promise<void>,
  onDelete: (commentId: string) => void | Promise<void>
): CommentThread {
  const resolved = !!comment.resolvedAt;
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [collapsed, setCollapsed] = useState(resolved && !focused);

  // A thread the agent resolves while it is on screen folds itself away; one it
  // reopens comes back, rather than staying collapsed behind a stale flag.
  const [syncedResolved, setSyncedResolved] = useState(resolved);
  if (syncedResolved !== resolved) {
    setSyncedResolved(resolved);
    setCollapsed(resolved);
  }

  // Jumping to a resolved note from the index has to show it, not a summary.
  const [syncedFocus, setSyncedFocus] = useState(focused);
  if (syncedFocus !== focused) {
    setSyncedFocus(focused);
    if (focused) setCollapsed(false);
  }

  // A second click confirms the delete; anything else takes the offer back.
  useEffect(() => {
    if (!confirmDelete) return;
    const handle = window.setTimeout(() => setConfirmDelete(false), 4_000);
    return () => window.clearTimeout(handle);
  }, [confirmDelete]);

  return {
    collapsed,
    setCollapsed,
    reply,
    setReply,
    replying,
    setReplying,
    busy,
    async sendReply() {
      const body = reply.trim();
      if (!body || busy) return;
      setBusy(true);
      try {
        await onReply(comment.id, body);
        setReply('');
        setReplying(false);
      } finally {
        setBusy(false);
      }
    },
    confirmDelete,
    remove() {
      if (!confirmDelete) {
        setConfirmDelete(true);
        return;
      }
      setConfirmDelete(false);
      void onDelete(comment.id);
    }
  };
}
