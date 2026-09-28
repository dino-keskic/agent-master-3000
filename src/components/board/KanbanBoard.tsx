import React from 'react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { TaskChangeSummary } from '../../../shared/git/changeSummary';
import { ColumnPanel } from './ColumnPanel';
import { useCardDrag } from './useCardDrag';

interface KanbanBoardProps {
  tasks: BoardTask[];
  columns: BoardColumn[];
  /** The same summaries the "changed files" filter was applied with. */
  changes: Record<string, TaskChangeSummary>;
  onSelectTask: (task: BoardTask) => void;
  onMoveTask: (taskId: string, columnId: string) => void | Promise<void>;
  onArchiveTask: (taskId: string) => void | Promise<void>;
  onClearColumn: (columnId: string) => void | Promise<void>;
  onStopTask: (taskId: string) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  onFocusPromptInput: () => void;
}

/**
 * The board itself: one panel per column, side by side.
 *
 * A column knows how to draw itself (`board/ColumnPanel`); what is here is how
 * many there are, how wide they get, and how tall. The rows are `fr` rather
 * than auto so every column runs the full height of the board: a card has to
 * be droppable into an empty column, and into the space under a short one.
 */
export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tasks,
  columns,
  onSelectTask,
  onMoveTask,
  onArchiveTask,
  onClearColumn,
  onStopTask,
  onRunTask,
  onFocusPromptInput,
  changes
}) => {
  const drag = useCardDrag(onMoveTask);
  // The first column is the inbox — where a prompt typed above lands.
  const inboxId = columns[0]?.id;

  return (
    <div
      className="grid auto-rows-fr gap-5 min-h-[calc(100vh-280px)] pb-10 overflow-x-auto"
      style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(280px, 1fr))` }}
    >
      {columns.map((column) => (
        <ColumnPanel
          key={column.id}
          column={column}
          tasks={tasks.filter((task) => task.columnId === column.id)}
          isInbox={column.id === inboxId}
          drag={drag}
          changes={changes}
          onSelectTask={onSelectTask}
          onArchiveTask={onArchiveTask}
          onClearColumn={onClearColumn}
          onStopTask={onStopTask}
          onRunTask={onRunTask}
          onFocusPromptInput={onFocusPromptInput}
        />
      ))}
    </div>
  );
};
