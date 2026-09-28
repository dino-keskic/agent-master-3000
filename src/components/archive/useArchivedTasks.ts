import { useCallback, useEffect, useState } from 'react';
import { BoardTask } from '../../../shared/types';
import { api } from '../../api';
import { errorMessage, notifySuccess, reportError } from '../../app/notify';

/**
 * The archived tasks, and the two things the panel does to one.
 *
 * They are not part of the board list — `GET /api/board` stops at the live
 * tasks — so the panel fetches its own, and re-reads after every write rather
 * than patching a second copy of the same fact. The list is small (titles and
 * dates, no transcripts) and only read while the panel is open.
 */

export interface ArchivedTasks {
  tasks: BoardTask[];
  loading: boolean;
  error?: string;
  reload: () => void;
  /** Permanent. The server refuses it for anything still on the board. */
  deleteForever: (taskId: string) => Promise<void>;
}

export function useArchivedTasks(opened: boolean): ArchivedTasks {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reloadCount, setReloadCount] = useState(0);

  const reload = useCallback(() => setReloadCount((n) => n + 1), []);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoading(true);
    api
      .archivedTasks()
      .then((res) => {
        if (cancelled) return;
        setTasks(res.tasks);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e, 'Could not read the archive'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [opened, reloadCount]);

  const deleteForever = useCallback(async (taskId: string) => {
    try {
      await api.deleteArchivedTask(taskId);
      setTasks((prev) => prev.filter((task) => task.id !== taskId));
      notifySuccess('Deleted', `${taskId} is gone for good.`);
    } catch (e) {
      reportError('Could not delete that task', e);
      reload();
    }
  }, [reload]);

  return { tasks, loading, error, reload, deleteForever };
}
