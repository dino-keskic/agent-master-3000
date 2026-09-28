import { useCallback, useEffect, useRef, useState } from 'react';
import { BoardTask } from '../../shared/types';
import { hrefWithTasks, taskIdsFromSearch } from '../../shared/board/deepLink';
import {
  closeTask,
  EMPTY_LAYOUT,
  focusTask,
  layoutOf,
  openBeside,
  openTask,
  pruneLayout,
  SplitLayout
} from '../../shared/board/splitLayout';
import { api } from '../api';
import { reportError } from './notify';

/**
 * Which tasks the workspace is showing, side by side, and which has focus.
 *
 * Only ids are held; each task is looked up in the board, so a card and the
 * panel showing it can never drift apart, and a task that is deleted takes its
 * panel with it. The ids are also the `?task=` deep link, which makes a split
 * view openable in its own tab and survive a reload. The rules for what opens
 * where are `shared/board/splitLayout`.
 */

export interface OpenTasks {
  /** The open tasks, left to right. */
  tasks: BoardTask[];
  /** Open task ids, left to right. Keeps its identity while the layout does. */
  openTaskIds: string[];
  focusedId: string | null;
  /** Session a panel should show, when its task was opened from a notification. */
  focusSessionIds: Record<string, string>;
  focusHandled: (taskId: string) => void;
  /** Show a task the plain way: alone, or in place of the focused panel. */
  select: (task: BoardTask) => void;
  /** Open a task in a panel of its own, right of `anchorId`. */
  openBeside: (taskId: string, anchorId?: string) => void;
  /**
   * Open a task at one of its sessions, beside what is already open — a
   * notification should not throw away the panel the user was working in.
   * False when the board has no such task.
   */
  open: (taskId: string, sessionId?: string) => boolean;
  focus: (taskId: string) => void;
  close: (taskId: string) => void;
  closeAll: () => void;
}

export function useOpenTasks(
  tasks: BoardTask[],
  applySnapshot: (task: BoardTask) => void
): OpenTasks {
  const [stored, setLayout] = useState<SplitLayout>(() => layoutOf(taskIdsFromSearch(window.location.search)));
  const [focusSessionIds, setFocusSessionIds] = useState<Record<string, string>>({});

  // A panel whose task left the board closes during render, so no frame is
  // painted with a gap. Before the first load there is no board to judge by,
  // and a deep link must not be thrown away for arriving early.
  const pruned = tasks.length > 0
    ? pruneLayout(stored, (id) => tasks.some((task) => task.id === id))
    : stored;
  if (pruned !== stored) setLayout(pruned);
  const layout = pruned;

  const openTasks = layout.taskIds
    .map((id) => tasks.find((task) => task.id === id))
    .filter((task): task is BoardTask => !!task);

  /**
   * A panel is the only view that wants a whole transcript. List payloads omit
   * it, and a session that kept running elsewhere will have moved on since the
   * last snapshot — so each newly opened task is re-read (the server resyncs
   * from OpenCode). Deltas that stream in while the request is in flight
   * survive: the merge keeps log ids the response has never seen.
   *
   * Tasks already open are not re-read when a neighbour opens or closes. That
   * is also why a response is checked against what is open *now* rather than
   * cancelled by this effect's cleanup: opening a second panel must not drop
   * the first panel's transcript still on its way.
   */
  const openIds = useRef<string[]>([]);
  useEffect(() => {
    const previous = openIds.current;
    openIds.current = layout.taskIds;
    for (const id of layout.taskIds) {
      if (previous.includes(id)) continue;
      api.getTask(id)
        .then((full) => {
          if (openIds.current.includes(id)) applySnapshot(full);
        })
        .catch((e) => {
          if (openIds.current.includes(id)) reportError('Could not load this transcript', e);
        });
    }
  }, [layout.taskIds, applySnapshot]);

  // Keep the URL in step with the open panels so the address bar is shareable
  // and a reload lands back on the same split.
  useEffect(() => {
    const href = hrefWithTasks(window.location.href, layout.taskIds);
    if (href) window.history.replaceState(null, '', href);
  }, [layout.taskIds]);

  const open = useCallback(
    (taskId: string, sessionId?: string) => {
      const target = tasks.find((item) => item.id === taskId);
      if (!target) return false;
      // Opening from a notification has to land on the *session* that was
      // clicked, not just on the task — otherwise a fork that needs an answer
      // opens showing the main conversation instead.
      const focus = sessionId || target.activeSessionId || target.sessionId;
      if (focus) {
        setFocusSessionIds((prev) => ({ ...prev, [taskId]: focus }));
        void api.switchSession(taskId, focus).catch(() => {});
      }
      setLayout((prev) => openBeside(prev, taskId));
      return true;
    },
    [tasks]
  );

  // Every callback below keeps its identity across renders: `select` reaches
  // each memoised `TaskCard`, and a fresh one per status tick re-renders the board.
  const focusHandled = useCallback((taskId: string) => {
    setFocusSessionIds((prev) => {
      if (!(taskId in prev)) return prev;
      const next = { ...prev };
      delete next[taskId];
      return next;
    });
  }, []);

  return {
    tasks: openTasks,
    openTaskIds: layout.taskIds,
    focusedId: layout.focusedId,
    focusSessionIds,
    focusHandled,
    select: useCallback((task: BoardTask) => setLayout((prev) => openTask(prev, task.id)), []),
    openBeside: useCallback(
      (taskId: string, anchorId?: string) => setLayout((prev) => openBeside(prev, taskId, anchorId)),
      []
    ),
    open,
    focus: useCallback((taskId: string) => setLayout((prev) => focusTask(prev, taskId)), []),
    close: useCallback((taskId: string) => {
      setLayout((prev) => closeTask(prev, taskId));
      focusHandled(taskId);
    }, [focusHandled]),
    closeAll: useCallback(() => {
      setLayout(EMPTY_LAYOUT);
      setFocusSessionIds({});
    }, [])
  };
}
