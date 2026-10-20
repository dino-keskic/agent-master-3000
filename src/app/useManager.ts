import { useCallback, useMemo } from 'react';
import { findManager, withoutManager } from '../../shared/manager/identity';
import { BoardTask, TaskRunState } from '../../shared/types';
import { api } from '../api';
import { reportError } from './notify';

/**
 * The manager, split off the board.
 *
 * It is a task like any other — the drawer opens it and the socket keeps it
 * current — so the board hands it over with everything else, and this is where
 * it is taken back out of the kanban's list and given its own button.
 */

export interface BoardManager {
  /** Every task but the manager: what the kanban and its counts are made of. */
  boardTasks: BoardTask[];
  /** What the manager is doing, once it exists. */
  state?: TaskRunState;
  /** Show the manager, making it the first time. */
  open: () => Promise<void>;
}

export function useManager(
  tasks: BoardTask[],
  applySnapshot: (task: BoardTask) => void,
  select: (task: BoardTask) => void
): BoardManager {
  const boardTasks = useMemo(() => withoutManager(tasks), [tasks]);
  const manager = useMemo(() => findManager(tasks), [tasks]);

  const open = useCallback(async () => {
    if (manager) {
      select(manager);
      return;
    }
    try {
      const made = await api.openManager();
      applySnapshot(made);
      select(made);
    } catch (e) {
      reportError('Could not start the manager', e);
    }
  }, [manager, applySnapshot, select]);

  return { boardTasks, state: manager?.runState, open };
}
