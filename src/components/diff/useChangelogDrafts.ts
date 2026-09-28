import { useState } from 'react';
import { BoardTask } from '../../../shared/types';
import { DraftTarget } from '../../../shared/review/diffDrafts';
import { api } from '../../api';
import { reportError } from '../../app/notify';
import { DraftControls, ThreadControls } from './controls';

/**
 * Review notes on a diff, from the board's side.
 *
 * Every write here answers with the whole task, because a note is part of it —
 * so each one ends by handing that task back to the board rather than patching
 * a local copy of the list.
 */

export interface ChangelogDrafts {
  drafts: DraftControls;
  threads: Omit<ThreadControls, 'focusedId'>;
}

export function useChangelogDrafts(
  taskId: string,
  /** Open the file a note is being written on, so the draft box is visible. */
  expand: (path: string, cwd?: string) => void,
  onApplyTask?: (task: BoardTask) => void
): ChangelogDrafts {
  const [target, setTarget] = useState<DraftTarget | null>(null);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const cancel = () => {
    setTarget(null);
    setBody('');
  };

  const write = async (label: string, run: () => Promise<BoardTask>) => {
    try {
      onApplyTask?.(await run());
      return true;
    } catch (e) {
      reportError(label, e);
      return false;
    }
  };

  return {
    drafts: {
      target,
      body,
      saving,
      setBody,
      cancel,
      start(next) {
        expand(next.path, next.cwd);
        setTarget(next);
        setBody('');
      },
      submit() {
        if (!target || !body.trim() || saving) return;
        setSaving(true);
        void write('Could not save that comment', () =>
          api.addChangelogComment(taskId, { ...target, body })
        )
          .then((ok) => {
            if (ok) cancel();
          })
          .finally(() => setSaving(false));
      }
    },
    threads: {
      async onReply(commentId, text) {
        await write('Could not reply', () => api.replyToChangelogComment(taskId, commentId, text));
      },
      async onResolve(commentId, resolved) {
        await write('Could not update that comment', () =>
          api.resolveChangelogComment(taskId, commentId, resolved)
        );
      },
      async onDelete(commentId) {
        await write('Could not delete that comment', () =>
          api.deleteChangelogComment(taskId, commentId)
        );
      }
    }
  };
}
