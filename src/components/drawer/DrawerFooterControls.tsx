import React from 'react';
import { Group, Select, Tooltip } from '@mantine/core';
import { Play, Shrink } from 'lucide-react';
import { BoardColumn, TaskRunState } from '../../../shared/types';
import { Button, Type } from '../ui';

interface DrawerFooterControlsProps {
  columns: BoardColumn[];
  columnId: string;
  /** State of the session on screen, not of the task. */
  runState: TaskRunState;
  busy: boolean;
  isSubagentView: boolean;
  /** Whether the view has a session at all — a fresh task has none. */
  hasSession: boolean;
  folderGone: boolean;
  runLabel: string;
  isCompacting: boolean;
  onMoveColumn: (columnId: string) => void;
  onCompact: () => void;
  onRun: () => void;
}

/** Why the Compact button is unavailable, or what it does when it is. */
function compactHint(isSubagentView: boolean, hasSession: boolean, busy: boolean): string {
  if (isSubagentView) return 'Subagent transcripts cannot be compacted';
  if (!hasSession) return 'This task has not started a session yet';
  if (busy) return 'Wait for this session\'s turn to finish';
  return 'Summarize the conversation so far to free up context';
}

function statusLabel(runState: TaskRunState): string {
  if (runState === 'awaiting_input') return '· waiting for you';
  if (runState === 'running') return '· running';
  if (runState === 'error') return '· error';
  return '';
}

/**
 * The row above the composer: which column the task sits in, what the session
 * on screen is doing, and what can be done to it while it is at rest. Stopping
 * a running turn is the composer's, beside Send — one button, in one place.
 */
export const DrawerFooterControls: React.FC<DrawerFooterControlsProps> = ({
  columns,
  columnId,
  runState,
  busy,
  isSubagentView,
  hasSession,
  folderGone,
  runLabel,
  isCompacting,
  onMoveColumn,
  onCompact,
  onRun
}) => (
  <Group justify="space-between" align="center">
    <Group gap={6} wrap="nowrap">
      <Tooltip label="Move this task to another column" withArrow>
        <Select
          size="xs"
          variant="unstyled"
          aria-label="Column"
          value={columnId}
          data={columns.map((c) => ({ value: c.id, label: c.title }))}
          allowDeselect={false}
          onChange={(val) => val && val !== columnId && onMoveColumn(val)}
          classNames={{ input: 'font-mono text-[12px] font-semibold tracking-wider text-ink uppercase' }}
          w={140}
        />
      </Tooltip>
      <Type role="stat" tone="muted" className="font-medium uppercase">
        {statusLabel(runState)}
      </Type>
    </Group>

    <Group gap="xs">
      <Tooltip label={compactHint(isSubagentView, hasSession, busy)} withArrow>
        <Button
          size="xs"
          variant="ghost"
          disabled={!hasSession || busy || isSubagentView}
          loading={isCompacting}
          leftSection={<Shrink className="w-3.5 h-3.5" />}
          onClick={onCompact}
        >
          Compact
        </Button>
      </Tooltip>

      {isSubagentView || busy ? null : (
        <Tooltip label={folderGone ? 'Folder is gone — this worktree was deleted' : undefined} disabled={!folderGone} withArrow>
          <Button
            size="xs"
            variant="ghost"
            disabled={folderGone}
            leftSection={<Play className="w-3.5 h-3.5 fill-current" />}
            onClick={onRun}
          >
            {runLabel}
          </Button>
        </Tooltip>
      )}
    </Group>
  </Group>
);
