import React, { useRef } from 'react';
import { useMediaQuery } from '@mantine/hooks';
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
  /** Opens the new-task sheet, from the empty first column. */
  onNewTask: () => void;
  /** What a new task would run with, so cards only name what differs. */
  defaultModel?: string;
  defaultAgent?: string;
  /** The card the keyboard walk is on. */
  focusedTaskId?: string;
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
  onNewTask,
  defaultModel,
  defaultAgent,
  focusedTaskId,
  changes
}) => {
  const drag = useCardDrag(onMoveTask);
  const isMobile = useMediaQuery('(max-width: 639px)') ?? false;
  const colRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // The first column is the inbox — where a prompt typed above lands.
  const inboxId = columns[0]?.id;

  const jumpToColumn = (columnId: string) => {
    colRefs.current[columnId]?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {isMobile && columns.length > 1 && (
        <div
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
          role="navigation"
          aria-label="Board columns"
        >
          {columns.map((column) => {
            const colTasks = tasks.filter((task) => task.columnId === column.id);
            const running = colTasks.some((task) => task.runState === 'running');
            return (
              <button
                key={column.id}
                type="button"
                onClick={() => jumpToColumn(column.id)}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-line bg-surface/80 text-[12px] font-medium text-ink-2 hover:text-ink shrink-0 cursor-pointer"
              >
                {running && <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse shrink-0" />}
                <span className="truncate max-w-[130px]">{column.title}</span>
                <span className="font-mono text-[11px] text-ink-4 tabular-nums">{colTasks.length}</span>
              </button>
            );
          })}
        </div>
      )}

      <div
        className="grid auto-rows-fr gap-3 sm:gap-4 min-h-[calc(100dvh-160px)] sm:min-h-[calc(100dvh-120px)] pb-6 overflow-x-auto snap-x snap-mandatory sm:snap-none"
        style={{
          gridTemplateColumns: isMobile
            ? `repeat(${Math.max(columns.length, 1)}, minmax(min(86vw, 340px), 1fr))`
            : `repeat(${Math.max(columns.length, 1)}, minmax(280px, 1fr))`
        }}
      >
        {columns.map((column) => (
          <div
            key={column.id}
            ref={(node) => {
              colRefs.current[column.id] = node;
            }}
            className="snap-center sm:snap-none min-w-0 flex flex-col"
          >
            <ColumnPanel
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
              onNewTask={onNewTask}
              defaultModel={defaultModel}
              defaultAgent={defaultAgent}
              focusedTaskId={focusedTaskId}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
