import { useCallback } from 'react';
import { BoardColumn, BoardTask, PermissionAnswer, PromptImage, TaskLogItem } from '../../shared/types';
import { findColumn } from '../../shared/board/columns';
import { api } from '../api';
import { notifySuccess, reportError } from './notify';

/**
 * Everything the board asks the server to do to a task.
 *
 * Each one is a request whose reply is the task itself, so they all end the
 * same way: hand the answer to `applySnapshot` and let the board redraw.
 * They are held stable because every card takes them as props — `TaskCard` is
 * memoised, and a fresh closure per render would re-render the whole board on
 * every status tick, which is most of what a running turn costs the browser.
 */

export interface TaskActionContext {
  columns: BoardColumn[];
  applySnapshot: (task: BoardTask, log?: TaskLogItem) => void;
  removeTasks: (taskIds: string[]) => void;
  /** Re-read the board, after a write that may have raced something else. */
  refresh: () => Promise<void>;
}

export interface TaskActions {
  moveTask: (taskId: string, columnId: string) => Promise<void>;
  runTask: (taskId: string) => Promise<void>;
  /** Resolves to the task the server made, so the caller can open it. */
  createTask: (input: Partial<BoardTask>, startImmediately?: boolean) => Promise<BoardTask>;
  updateTask: (taskId: string, updates: Partial<BoardTask>) => Promise<void>;
  /** Resolves false when the server refused it, which has already been reported. */
  sendPrompt: (taskId: string, prompt: string, images?: PromptImage[]) => Promise<boolean>;
  /** Take a task off the board, keeping everything it holds. */
  archiveTask: (taskId: string) => Promise<void>;
  /** Put an archived task back, from the archive panel. */
  restoreTask: (taskId: string) => Promise<void>;
  /** Archives every task in the column. */
  clearColumn: (columnId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  /** Stops one session and leaves the task's others running. */
  stopSession: (taskId: string, sessionId: string) => Promise<void>;
  respond: (taskId: string, answer: PermissionAnswer) => Promise<void>;
}

/**
 * Most of these are the same request twice over: call the endpoint, hand the
 * task it returns to the board, and name what failed if it did. The API
 * functions are module-level, so the callback this returns is stable.
 */
function useSnapshotAction<A extends unknown[]>(
  applySnapshot: (task: BoardTask) => void,
  failure: string,
  call: (...args: A) => Promise<BoardTask>
): (...args: A) => Promise<void> {
  return useCallback(
    async (...args: A) => {
      try {
        applySnapshot(await call(...args));
      } catch (e) {
        reportError(failure, e);
      }
    },
    [applySnapshot, failure, call]
  );
}

export function useTaskActions(ctx: TaskActionContext): TaskActions {
  const { columns, applySnapshot, removeTasks, refresh } = ctx;

  const moveTask = useSnapshotAction(applySnapshot, 'Could not move task', api.moveTask);
  const runTask = useSnapshotAction(applySnapshot, 'Could not run task', api.runTask);
  const updateTask = useSnapshotAction(applySnapshot, 'Could not update task', api.updateTask);
  // Not a snapshot action: the drawer has already drawn the prompt, and takes
  // it back when this says the server refused it.
  const sendPrompt = useCallback(async (taskId: string, prompt: string, images?: PromptImage[]) => {
    try {
      applySnapshot(await api.promptTask(taskId, prompt, images));
      return true;
    } catch (e) {
      reportError('Could not send prompt', e);
      return false;
    }
  }, [applySnapshot]);
  const stopTask = useSnapshotAction(applySnapshot, 'Could not stop task', api.stopTask);
  const stopSession = useSnapshotAction(applySnapshot, 'Could not stop that session', api.stopSession);

  const createTask = useCallback(async (input: Partial<BoardTask>, startImmediately = false) => {
    try {
      // The socket may have delivered this task already; the merge is what
      // keeps it from being added a second time.
      const created = await api.createTask(input);
      applySnapshot(created);
      if (startImmediately) void runTask(created.id);
      return created;
    } catch (e) {
      reportError('Could not create task', e);
      throw e;
    }
  }, [applySnapshot, runTask]);

  const archiveTask = useCallback(async (taskId: string) => {
    try {
      await api.archiveTask(taskId);
      removeTasks([taskId]);
      notifySuccess('Archived', `${taskId} is in the archive — restore it from the header.`);
    } catch (e) {
      reportError('Could not archive task', e);
    }
  }, [removeTasks]);

  const restoreTask = useCallback(async (taskId: string) => {
    try {
      applySnapshot(await api.restoreTask(taskId));
      notifySuccess('Restored', `${taskId} is back on the board.`);
    } catch (e) {
      reportError('Could not restore task', e);
    }
  }, [applySnapshot]);

  const clearColumn = useCallback(async (columnId: string) => {
    try {
      const { archived } = await api.clearColumn(columnId);
      removeTasks(archived);
      const title = findColumn(columns, columnId)?.title || columnId;
      notifySuccess(
        'Archived',
        archived.length === 1
          ? `1 task from ${title} is in the archive`
          : `${archived.length} tasks from ${title} are in the archive`
      );
    } catch (e) {
      reportError('Could not clear that column', e);
    }
  }, [columns, removeTasks]);

  const respond = useCallback(async (taskId: string, answer: PermissionAnswer) => {
    try {
      applySnapshot(await api.respond(taskId, answer));
    } catch (e) {
      reportError('Could not send your answer', e);
      // The request may have expired while the drawer was open; resync.
      void refresh();
    }
  }, [applySnapshot, refresh]);

  return {
    moveTask,
    runTask,
    createTask,
    updateTask,
    sendPrompt,
    archiveTask,
    restoreTask,
    clearColumn,
    stopTask,
    stopSession,
    respond
  };
}
