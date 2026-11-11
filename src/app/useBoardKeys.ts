import { useEffect, useRef, useState } from 'react';
import { BoardColumn, BoardTask } from '../../shared/types';
import { boardKeyAction, isTypingTarget } from '../../shared/board/boardKeys';
import { boardOrder, stepTask, workGroups } from '../../shared/board/workList';

/**
 * The board from the keyboard: j / k walk the tasks, Enter opens the one the
 * walk is on, n (or ⌘N in the desktop app) starts a new one.
 *
 * On the board the walk moves a focus ring down each column. With a task open
 * there are no columns, so it moves the open task through the list beside it,
 * in that list's order.
 */

interface BoardKeysInput {
  /** The tasks on the board, after the filters. */
  tasks: BoardTask[];
  /** Every task in the list beside an open one, which the filters do not narrow. */
  listed: BoardTask[];
  columns: BoardColumn[];
  /** The open task the walk continues from, when there is one. */
  openTaskId?: string;
  /** Something over the board has the keyboard. */
  blocked: boolean;
  onOpen: (task: BoardTask) => void;
  onNewTask: () => void;
}

export function useBoardKeys(input: BoardKeysInput): string | undefined {
  const [focusedId, setFocusedId] = useState<string>();
  // The listener is bound once and reads what is current through this, so a
  // status tick never costs a re-bind.
  const latest = useRef({ ...input, focusedId });
  useEffect(() => {
    latest.current = { ...input, focusedId };
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const now = latest.current;
      const target = event.target instanceof HTMLElement ? event.target : undefined;
      const action = boardKeyAction(event, {
        typing: !!target && isTypingTarget({
          tagName: target.tagName,
          isContentEditable: target.isContentEditable,
          role: target.getAttribute('role')
        }),
        blocked: now.blocked,
        taskOpen: !!now.openTaskId
      });
      if (!action) return;
      const byId = (id: string | undefined) => now.listed.find((task) => task.id === id);

      if (action === 'new') {
        event.preventDefault();
        now.onNewTask();
        return;
      }
      if (action === 'open') {
        const task = byId(now.focusedId);
        if (!task) return;
        event.preventDefault();
        now.onOpen(task);
        return;
      }

      event.preventDefault();
      const delta = action === 'next' ? 1 : -1;
      if (now.openTaskId) {
        const order = workGroups(now.listed).flatMap((group) => group.tasks.map((task) => task.id));
        const task = byId(stepTask(order, now.openTaskId, delta));
        if (task && task.id !== now.openTaskId) now.onOpen(task);
        return;
      }
      const next = stepTask(boardOrder(now.tasks, now.columns), now.focusedId, delta);
      setFocusedId(next);
      if (next) document.querySelector(`[data-task-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A ring on a task that has left the board would send Enter nowhere.
  return focusedId && input.tasks.some((task) => task.id === focusedId) ? focusedId : undefined;
}
