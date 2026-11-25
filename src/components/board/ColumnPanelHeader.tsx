import React from 'react';
import { Group, Menu } from '@mantine/core';
import { Archive, Circle, MoreHorizontal, Plus, Zap } from 'lucide-react';
import { BoardColumn } from '../../../shared/types';
import { columnRunsOnDrop } from '../../../shared/board/columns';
import { Chip } from '../ui';

/** A column's name, what it is doing, and the two things you can do to it. */

interface ColumnPanelHeaderProps {
  column: BoardColumn;
  taskCount: number;
  runningCount: number;
  /** The first column is where a new task lands, so only it offers the shortcut. */
  isInbox: boolean;
  onNewTask: () => void;
  onClearColumn: (columnId: string) => void | Promise<void>;
}

export const ColumnPanelHeader: React.FC<ColumnPanelHeaderProps> = ({
  column,
  taskCount,
  runningCount,
  isInbox,
  onNewTask,
  onClearColumn
}) => {
  const clear = () => {
    const noun = taskCount === 1 ? 'task' : 'tasks';
    if (
      !window.confirm(
        `Archive ${taskCount} ${noun} from ${column.title}? They leave the board and keep everything — restore them from the archive.`
      )
    ) {
      return;
    }
    void onClearColumn(column.id);
  };

  return (
    <Group justify="space-between" align="center" pb={10} mb={10} className="border-b border-hairline">
      <Group gap="xs">
        {runningCount > 0 ? (
          <span className="relative flex h-2 w-2 shrink-0" aria-label={`${runningCount} running`}>
            <span className="pulse-ring" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-run" />
          </span>
        ) : (
          <Circle className="w-3.5 h-3.5 text-ink-4" />
        )}
        <h2 className="text-[13px] font-semibold text-ink m-0">{column.title}</h2>
        <span className={`bubble${runningCount > 0 ? ' is-running' : ''}`}>{taskCount}</span>
        {columnRunsOnDrop(column) && (
          <Chip tone="accent" className="gap-1" title="Dropping a task here automatically runs its stage prompt">
            <Zap className="w-2.5 h-2.5" />
            drop runs
          </Chip>
        )}
      </Group>

      <Group gap={4} wrap="nowrap">
        {isInbox && (
          <button type="button" className="hdr-btn h-6 px-2 text-[12px]" onClick={onNewTask}>
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        )}
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <button
              type="button"
              className="icon-btn w-6 h-6"
              aria-label={`${column.title} column actions`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              leftSection={<Archive className="w-3.5 h-3.5" />}
              disabled={taskCount === 0}
              onClick={clear}
            >
              Archive all
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
};
