import { useState } from 'react';
import { notifications } from '@mantine/notifications';
import { AlertCircle, Download } from 'lucide-react';
import React from 'react';
import { AcpSessionSummary } from '../../../shared/sessions/types';
import { BoardTask } from '../../../shared/types';
import { api } from '../../api';
import { errorMessage, notifySuccess, reportError } from '../../app/notify';

/**
 * What the user picked, and getting it onto the board.
 *
 * Finding the sessions is `useSessionList`'s job; this one only owns the
 * selection and the import runs it turns into.
 */

export interface SessionImport {
  /** The session being imported right now, if any. */
  importingId: string | null;
  selected: Set<string>;
  toggle: (sessionId: string) => void;
  allSelected: boolean;
  toggleAll: () => void;
  selectableCount: number;
  /** Set while a bulk import is walking the queue. */
  progress: { done: number; total: number } | null;
  importOne: (session: AcpSessionSummary) => Promise<void>;
  importSelected: () => Promise<void>;
}

export function useSessionImport(
  isOpen: boolean,
  visible: AcpSessionSummary[],
  onImported: (task: BoardTask) => void | Promise<void>,
  onDone: () => void,
  refresh: () => void
): SessionImport {
  const [importingId, setImportingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // A closed modal keeps nothing selected; reopening starts clean.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (!isOpen) {
      setSelected(new Set());
      setProgress(null);
    }
  }

  const selectable = visible.filter((s) => !s.importedAsTaskId);
  const allSelected = selectable.length > 0 && selectable.every((s) => selected.has(s.sessionId));

  /** Imports one session and hands the new task to the board. */
  const runImport = async (session: AcpSessionSummary): Promise<BoardTask> => {
    const task = await api.importSession(session.sessionId, session.cwd);
    void onImported(task);
    return task;
  };

  return {
    importingId,
    selected,
    toggle: (sessionId) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) next.delete(sessionId);
        else next.add(sessionId);
        return next;
      });
    },
    allSelected,
    toggleAll: () => setSelected(allSelected ? new Set() : new Set(selectable.map((s) => s.sessionId))),
    selectableCount: selectable.length,
    progress,
    async importOne(session) {
      setImportingId(session.sessionId);
      try {
        const task = await runImport(session);
        notifySuccess('Session imported', `"${session.title}" is now ${task.id}`);
        onDone();
      } catch (e) {
        reportError('Import failed', e);
      }
      setImportingId(null);
    },
    /**
     * Imports the selection one at a time. One failure does not stop the rest —
     * a session whose worktree is gone should not cost you the other nine.
     */
    async importSelected() {
      const queue = visible.filter((s) => selected.has(s.sessionId) && !s.importedAsTaskId);
      if (queue.length === 0) return;

      setProgress({ done: 0, total: queue.length });
      const failures: string[] = [];
      for (const [index, session] of queue.entries()) {
        setImportingId(session.sessionId);
        try {
          await runImport(session);
        } catch (e) {
          failures.push(`${session.title}: ${errorMessage(e, 'failed')}`);
        }
        setProgress({ done: index + 1, total: queue.length });
      }

      setImportingId(null);
      setSelected(new Set());
      setProgress(null);
      refresh();

      const imported = queue.length - failures.length;
      const ok = failures.length === 0;
      notifications.show({
        title: ok ? 'Sessions Imported' : 'Import Finished With Errors',
        message: ok
          ? `Imported ${imported} session${imported === 1 ? '' : 's'} onto the board`
          : `Imported ${imported} of ${queue.length}. Failed: ${failures.slice(0, 2).join('; ')}`,
        color: ok ? 'accent' : 'orange',
        icon: React.createElement(ok ? Download : AlertCircle, { className: 'w-4 h-4' })
      });

      if (ok) onDone();
    }
  };
}
