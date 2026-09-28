import { useCallback, useState } from 'react';
import { BoardTask, TaskLogItem } from '../../shared/types';
import { appendTaskLog, mergeTaskSnapshot } from '../../shared/task/logs';

/**
 * The tasks themselves, and the only three ways the list changes.
 *
 * Tasks arrive from three directions — the initial load, the live socket, and
 * the reply to whatever the user just did — and every one of them merges rather
 * than replaces. That merge is what keeps a transcript already on screen from
 * being blanked by a list payload that omits it.
 */

export interface TaskList {
  tasks: BoardTask[];
  /** Fold a task the server just sent into the board. */
  applySnapshot: (task: BoardTask, log?: TaskLogItem) => void;
  /** Drop tasks the server no longer has. */
  removeTasks: (taskIds: string[]) => void;
  /** Take a whole board load, keeping the transcripts the stripped list omits. */
  replaceAll: (incoming: BoardTask[]) => void;
}

export function useTaskList(): TaskList {
  const [tasks, setTasks] = useState<BoardTask[]>([]);

  const applySnapshot = useCallback((incoming: BoardTask, log?: TaskLogItem) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t.id === incoming.id);
      const merged = mergeTaskSnapshot(idx < 0 ? undefined : prev[idx], incoming);
      const next = log ? appendTaskLog(merged, log) : merged;
      if (idx < 0) return [...prev, next];
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }, []);

  const removeTasks = useCallback((taskIds: string[]) => {
    const gone = new Set(taskIds);
    setTasks((prev) => prev.filter((task) => !gone.has(task.id)));
  }, []);

  const replaceAll = useCallback((incoming: BoardTask[]) => {
    setTasks((prev) => incoming.map((task) => mergeTaskSnapshot(prev.find((t) => t.id === task.id), task)));
  }, []);

  return { tasks, applySnapshot, removeTasks, replaceAll };
}
