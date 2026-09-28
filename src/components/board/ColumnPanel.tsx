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
  onFocusPromptInput: () => void;
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
  onFocusPromptInput
}) => {
  const isHovered = drag.overColumnId === column.id;

  return (
    <section
      onDragOver={(e) => drag.onColumnDragOver(e, column.id)}
      onDragLeave={() => drag.onColumnDragLeave(column.id)}
      onDrop={(e) => drag.onColumnDrop(e, column.id)}
      className={`glass-panel rounded-[14px] p-[18px] flex flex-col border ${
        isHovered ? 'border-line-strong' : ''
      } transition-all duration-150 min-w-0`}
    >
      <ColumnPanelHeader
        column={column}
        taskCount={tasks.length}
        runningCount={tasks.filter((t) => t.runState === 'running').length}
        isInbox={isInbox}
        onFocusPromptInput={onFocusPromptInput}
        onClearColumn={onClearColumn}
      />

      <ScrollArea className="flex-1 pr-1">
        <div className="flex flex-col gap-4 min-h-full">
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
                <button type="button" className="hdr-btn h-6 px-2 text-[11px]" onClick={onFocusPromptInput}>
                  + Type Prompt Above
                </button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
};
