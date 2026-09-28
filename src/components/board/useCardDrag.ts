import React, { useState } from 'react';

/**
 * Dragging a card from one column to another.
 *
 * The drop is the board's main gesture — it is what moves a task on, and what
 * a column with an on-enter prompt reacts to — so the state behind it is kept
 * in one place rather than spread over the columns it crosses.
 */

export interface CardDrag {
  /** The card being dragged, so its place on the board can show as vacated. */
  draggedTaskId: string | null;
  /** The column the pointer is currently over, so it can highlight. */
  overColumnId: string | null;
  onCardDragStart: (e: React.DragEvent, taskId: string) => void;
  onCardDragEnd: () => void;
  onColumnDragOver: (e: React.DragEvent, columnId: string) => void;
  onColumnDragLeave: (columnId: string) => void;
  onColumnDrop: (e: React.DragEvent, columnId: string) => void;
}

export function useCardDrag(onMoveTask: (taskId: string, columnId: string) => void | Promise<void>): CardDrag {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  const clear = () => {
    setDraggedTaskId(null);
    setOverColumnId(null);
  };

  return {
    draggedTaskId,
    overColumnId,
    onCardDragStart: (e, taskId) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', taskId);
      // The browser snapshots the card for the drag image once this handler
      // returns, so dimming it has to wait — done now, the user would drag a
      // faded ghost of the card instead of the card.
      setTimeout(() => setDraggedTaskId(taskId), 0);
    },
    // A card let go over the page rather than a column: nothing moves, but the
    // board must stop showing a drag that is over.
    onCardDragEnd: clear,
    onColumnDragOver: (e, columnId) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setOverColumnId(columnId);
    },
    onColumnDragLeave: (columnId) => {
      if (overColumnId === columnId) setOverColumnId(null);
    },
    onColumnDrop: (e, columnId) => {
      e.preventDefault();
      // The dataTransfer payload survives a drag the board never saw start.
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      if (taskId) void onMoveTask(taskId, columnId);
      clear();
    }
  };
}
