import React from 'react';
import { ActionIcon, Group, Menu } from '@mantine/core';
import { Archive, Circle, MoreHorizontal, Plus, Zap } from 'lucide-react';
import { BoardColumn } from '../../../shared/types';
import { columnRunsOnDrop } from '../../../shared/board/columns';

/** A column's name, what it is doing, and the two things you can do to it. */

interface ColumnPanelHeaderProps {
  column: BoardColumn;
  taskCount: number;
  runningCount: number;
  /** The first column is where a typed prompt lands, so only it offers the shortcut. */
  isInbox: boolean;
  onFocusPromptInput: () => void;
  onClearColumn: (columnId: string) => void | Promise<void>;
}

export const ColumnPanelHeader: React.FC<ColumnPanelHeaderProps> = ({
  column,
  taskCount,
  runningCount,
  isInbox,
  onFocusPromptInput,
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
    <Group justify="space-between" align="center" pb={12} mb={14} className="border-b border-hairline">
      <Group gap="xs">
        {runningCount > 0 ? (
          <span className="relative flex h-2 w-2 shrink-0" aria-label={`${runningCount} running`}>
            <span className="pulse-ring" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-run" />
          </span>
        ) : (
          <Circle className="w-3.5 h-3.5 text-ink-4" />
        )}
        <h2 className="text-[13px] font-semibold text-ink m-0">
          {column.title}
        </h2>
        <span className={`bubble${runningCount > 0 ? ' is-running' : ''}`}>{taskCount}</span>
        {columnRunsOnDrop(column) && (
          <span className="inline-flex items-center gap-1 h-[18px] px-[7px] rounded-full border border-line text-ink-3 text-[10px] font-medium">
            <Zap className="w-3 h-3" />
            drop runs
          </span>
        )}
      </Group>

      <Group gap={4} wrap="nowrap">
        {isInbox && (
          <button type="button" className="hdr-btn h-6 px-2 text-[11px]" onClick={onFocusPromptInput}>
            <Plus className="w-3.5 h-3.5" />
            Prompt
          </button>
        )}
        <Menu shadow="md" position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={`${column.title} column actions`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </ActionIcon>
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
