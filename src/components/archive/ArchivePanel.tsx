import React from 'react';
import { ActionIcon, Badge, Drawer, Group, Loader, ScrollArea, Stack, Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { BoardColumn, ProjectFolder } from '../../../shared/types';
import { ArchiveRow } from './ArchiveRow';
import { useArchivedTasks } from './useArchivedTasks';

/**
 * Where archived tasks are recovered from.
 *
 * Nothing the board deletes is destroyed any more: the card's Archive and a
 * cleared column both land here, newest first, with the whole task intact
 * behind the row. Restore puts it back; the delete here is the only permanent
 * one in the app, which is why it is confirmed and lives nowhere else.
 */

interface ArchivePanelProps {
  opened: boolean;
  onClose: () => void;
  columns: BoardColumn[];
  projects: ProjectFolder[];
  /** Restores through the board's own action, so the card reappears at once. */
  onRestore: (taskId: string) => Promise<void>;
}

const DRAWER_STYLES = {
  content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
  body: { padding: 0, height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' }
} as const;

export const ArchivePanel: React.FC<ArchivePanelProps> = ({
  opened,
  onClose,
  columns,
  projects,
  onRestore
}) => {
  const archive = useArchivedTasks(opened);

  const projectLabel = (projectId?: string, projectName?: string) =>
    projects.find((project) => project.id === projectId)?.name || projectName;

  const restore = async (taskId: string) => {
    await onRestore(taskId);
    // The board holds the restored card now; re-read so a failed restore
    // leaves the row where it is instead of the list quietly disagreeing.
    archive.reload();
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={
        <Group gap="xs" wrap="nowrap">
          <span className="text-sm font-semibold text-ink">Archive</span>
          {archive.tasks.length > 0 && (
            <Badge size="xs" color="gray" variant="light" className="font-mono">
              {archive.tasks.length}
            </Badge>
          )}
          {archive.loading && <Loader size="xs" color="gray" />}
        </Group>
      }
      styles={DRAWER_STYLES}
    >
      <Group justify="space-between" align="center" p="sm" className="shrink-0 border-b border-line/70">
        <span className="font-mono text-[11px] text-ink-3">
          Archived tasks keep their transcript, sessions and notes.
        </span>
        <Tooltip label="Re-read the archive" withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={archive.reload}
            aria-label="Refresh archive"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </ActionIcon>
        </Tooltip>
      </Group>

      <ScrollArea className="flex-1" type="auto">
        <Stack gap="xs" p="sm">
          {archive.error && (
            <span className="font-mono text-[12px] text-err-fg">{archive.error}</span>
          )}

          {!archive.error && archive.tasks.length === 0 && (
            <span className="font-mono text-[12px] text-ink-3">
              {archive.loading ? 'Reading the archive…' : 'Nothing archived'}
            </span>
          )}

          {archive.tasks.map((task) => (
            <ArchiveRow
              key={task.id}
              task={task}
              columns={columns}
              projectLabel={projectLabel(task.projectId, task.projectName)}
              onRestore={(taskId) => void restore(taskId)}
              onDeleteForever={(taskId) => void archive.deleteForever(taskId)}
            />
          ))}
        </Stack>
      </ScrollArea>
    </Drawer>
  );
};
