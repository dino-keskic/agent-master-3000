import React from 'react';
import { Group, Stack, Tooltip } from '@mantine/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { relativeTime } from '../../../shared/format';
import { restoreColumnId, restoreRehomes } from '../../../shared/task/archive';
import { Button } from '../ui';

/**
 * One archived task: what it was, where it came from, and when it left.
 *
 * The column line says where a restore actually lands, because the column a
 * task was archived from can be edited away while it sits here — the rule is
 * `restoreColumnId`, and this is the one place the user gets to see it before
 * clicking.
 */

interface ArchiveRowProps {
  task: BoardTask;
  columns: BoardColumn[];
  projectLabel?: string;
  onRestore: (taskId: string) => void;
  onDeleteForever: (taskId: string) => void;
}

export const ArchiveRow: React.FC<ArchiveRowProps> = ({
  task,
  columns,
  projectLabel,
  onRestore,
  onDeleteForever
}) => {
  const targetId = restoreColumnId(task, columns);
  const rehomed = restoreRehomes(task, columns);
  const columnTitle = columns.find((column) => column.id === targetId)?.title || targetId;

  const confirmDelete = () => {
    if (
      window.confirm(
        `Delete ${task.id} forever? Its transcript, sessions and review notes go with it. This cannot be undone.`
      )
    ) {
      onDeleteForever(task.id);
    }
  };

  return (
    <div className="rounded-[10px] border border-line bg-surface-2 p-3">
      <Stack gap={6}>
        <Group justify="space-between" align="flex-start" gap="xs" wrap="nowrap">
          <Stack gap={2} className="min-w-0">
            <Group gap={8} wrap="nowrap" className="min-w-0">
              <span className="font-mono text-[11px] text-ink-3 shrink-0">{task.id}</span>
              <span className="text-[13px] text-ink truncate">{task.title}</span>
            </Group>
            <Group gap={8} wrap="nowrap" className="min-w-0">
              {projectLabel && (
                <span className="font-mono text-[10.5px] text-ink-3 truncate">{projectLabel}</span>
              )}
              <span className={`font-mono text-[10.5px] ${rehomed ? 'text-wait-fg' : 'text-ink-3'}`}>
                {rehomed ? `→ ${columnTitle}` : columnTitle}
              </span>
              {task.archivedAt !== undefined && (
                <span className="font-mono text-[10.5px] text-ink-3 shrink-0">
                  archived {relativeTime(task.archivedAt)}
                </span>
              )}
            </Group>
          </Stack>

          <Group gap={6} wrap="nowrap" className="shrink-0">
            <Tooltip
              label={rehomed
                ? `Its column is gone — restores to ${columnTitle}`
                : `Restore to ${columnTitle}`}
              withArrow
            >
              <Button
                size="xs"
                variant="secondary"
                onClick={() => onRestore(task.id)}
                leftSection={<RotateCcw className="w-3 h-3" />}
              >
                Restore
              </Button>
            </Tooltip>
            <Tooltip label="Delete forever — this cannot be undone" withArrow>
              <Button
                size="icon-sm"
                variant="danger"
                aria-label={`Delete ${task.id} forever`}
                onClick={confirmDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          </Group>
        </Group>
      </Stack>
    </div>
  );
};
