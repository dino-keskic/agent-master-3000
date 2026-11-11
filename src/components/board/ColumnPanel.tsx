import React from 'react';
import { ScrollArea } from '@mantine/core';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { TaskChangeSummary } from '../../../shared/git/changeSummary';
import { TaskCard } from '../card/TaskCard';
import { ColumnPanelHeader } from './ColumnPanelHeader';
import { CardDrag } from './useCardDrag';

/** One column of the board: its header, its cards, and where a card lands. */

interface ColumnPanelProps {
  column: BoardColumn;
  tasks: BoardTask[];
  isInbox: boolean;
  drag: CardDrag;
  changes: Record<string, TaskChangeSummary>;
  onSelectTask: (task: BoardTask) => void;
  onArchiveTask: (taskId: string) => void | Promise<void>;
  onClearColumn: (columnId: string) => void | Promise<void>;
  onStopTask: (taskId: string) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  /** Opens the new-task sheet, from the empty first column. */
  onNewTask: () => void;
  /** What a new task would run with, so cards only name what differs. */
  defaultModel?: string;
  defaultAgent?: string;
  /** Where the keyboard walk is, when it is in this column. */
  focusedTaskId?: string;
}

export const ColumnPanel: React.FC<ColumnPanelProps> = ({
  column,
  tasks,
  isInbox,
  drag,
  changes,
  onSelectTask,
  onArchiveTask,
  onClearColumn,
  onStopTask,
  onRunTask,
  onNewTask,
  defaultModel,
  defaultAgent,
  focusedTaskId
}) => {
  const isHovered = drag.overColumnId === column.id;

  return (
    <section
      onDragOver={(e) => drag.onColumnDragOver(e, column.id)}
      onDragLeave={() => drag.onColumnDragLeave(column.id)}
      onDrop={(e) => drag.onColumnDrop(e, column.id)}
      className={`glass-panel rounded-[20px] p-3 flex flex-col border ${
        isHovered ? 'border-line-strong' : ''
      } transition-all duration-150 min-w-0`}
    >
      <ColumnPanelHeader
        column={column}
        taskCount={tasks.length}
        runningCount={tasks.filter((t) => t.runState === 'running').length}
        isInbox={isInbox}
        onNewTask={onNewTask}
        onClearColumn={onClearColumn}
      />

      <ScrollArea className="flex-1 pr-1">
        <div className="flex flex-col gap-2.5 min-h-full">
          {tasks.map((task) => (
            <div
              key={task.id}
              draggable
              onDragStart={(e) => drag.onCardDragStart(e, task.id)}
              onDragEnd={drag.onCardDragEnd}
              className={drag.draggedTaskId === task.id ? 'opacity-40' : undefined}
            >
              <TaskCard
                task={task}
                column={column}
                change={changes[task.id]}
                defaultModel={defaultModel}
                defaultAgent={defaultAgent}
                focused={task.id === focusedTaskId}
                onSelect={onSelectTask}
                onArchive={onArchiveTask}
                onStop={onStopTask}
                onRun={onRunTask}
              />
            </div>
          ))}

          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center gap-2 p-7 rounded-[10px] border-2 border-dashed border-dash min-h-[190px]">
              <span className="text-[12px] text-ink-3">
                No tasks in {column.title}
              </span>
              {isInbox && (
                <button type="button" className="hdr-btn h-7 px-2.5 text-[12px]" onClick={onNewTask}>
                  + New task
                </button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
};
