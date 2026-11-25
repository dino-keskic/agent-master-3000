import React, { useMemo, useState } from 'react';
import { Drawer, Loader, ScrollArea, Tooltip } from '@mantine/core';
import { AlertTriangle, Archive, RefreshCw } from 'lucide-react';
import { BoardColumn, ProjectFolder } from '../../../shared/types';
import { Banner, Chip, EmptyState, PaneToolbar, SearchInput } from '../ui';
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
  content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
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
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const projectLabel = React.useCallback(
    (projectId?: string, projectName?: string) =>
      projects.find((project) => project.id === projectId)?.name || projectName,
    [projects]
  );

  const projectFilters = useMemo(() => {
    const counts = new Map<string, { key: string; label: string; count: number }>();
    for (const task of archive.tasks) {
      const label = projectLabel(task.projectId, task.projectName) || 'Other';
      const key = task.projectId || label;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { key, label, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [archive.tasks, projectLabel]);

  const activeProjectFilter =
    projectFilter === 'all' || projectFilters.some((p) => p.key === projectFilter)
      ? projectFilter
      : 'all';

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    return archive.tasks.filter((task) => {
      if (activeProjectFilter !== 'all') {
        const label = projectLabel(task.projectId, task.projectName) || 'Other';
        const key = task.projectId || label;
        if (key !== activeProjectFilter) return false;
      }
      if (!q) return true;
      const proj = projectLabel(task.projectId, task.projectName) || '';
      return (
        task.title.toLowerCase().includes(q) ||
        task.id.toLowerCase().includes(q) ||
        proj.toLowerCase().includes(q) ||
        (task.prompt || '').toLowerCase().includes(q)
      );
    });
  }, [archive.tasks, query, activeProjectFilter, projectLabel]);

  const restore = async (taskId: string) => {
    await onRestore(taskId);
    archive.reload();
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={
        <div className="flex items-center gap-2">
          <Archive className="w-4 h-4 text-accent" />
          <span className="text-[14px] font-semibold text-ink">Archive</span>
          {archive.tasks.length > 0 && (
            <Chip className="font-mono">{archive.tasks.length}</Chip>
          )}
          {archive.loading && <Loader size="xs" color="gray" />}
        </div>
      }
      styles={DRAWER_STYLES}
    >
      <PaneToolbar
        left={
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search archived tasks…"
            containerClassName="w-72 max-w-full"
          />
        }
        right={
          <Tooltip label="Re-read the archive" withArrow>
            <button
              type="button"
              className="icon-btn"
              onClick={archive.reload}
              aria-label="Refresh archive"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        }
      />

      {projectFilters.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap px-3.5 py-2 border-b border-hairline bg-surface/50 shrink-0">
          <button
            type="button"
            onClick={() => setProjectFilter('all')}
            className={`h-6 px-2.5 rounded-full text-[11.5px] font-medium border cursor-pointer transition-colors ${
              activeProjectFilter === 'all'
                ? 'bg-acc-bg border-acc-bd text-acc-fg'
                : 'bg-surface border-line text-ink-3 hover:text-ink'
            }`}
          >
            All <span className="font-mono opacity-75 ml-0.5">{archive.tasks.length}</span>
          </button>
          {projectFilters.map((proj) => (
            <button
              key={proj.key}
              type="button"
              onClick={() => setProjectFilter(proj.key)}
              className={`h-6 px-2.5 rounded-full text-[11.5px] font-medium border cursor-pointer transition-colors ${
                activeProjectFilter === proj.key
                  ? 'bg-acc-bg border-acc-bd text-acc-fg'
                  : 'bg-surface border-line text-ink-3 hover:text-ink'
              }`}
            >
              {proj.label} <span className="font-mono opacity-75 ml-0.5">{proj.count}</span>
            </button>
          ))}
        </div>
      )}

      <ScrollArea className="flex-1" type="auto">
        <div className="flex flex-col gap-2.5 p-3.5">
          <p className="m-0 px-0.5 text-[12px] text-ink-3">
            Archived tasks keep their transcript, sessions, and review notes.
          </p>

          {archive.error && (
            <Banner tone="err" icon={<AlertTriangle className="w-4 h-4" />}>
              {archive.error}
            </Banner>
          )}

          {!archive.error && filteredTasks.length === 0 && (
            <EmptyState
              icon={<Archive className="w-4 h-4" />}
              title={
                archive.loading
                  ? 'Reading the archive…'
                  : query.trim()
                    ? 'No matching archived tasks'
                    : 'Nothing archived'
              }
              description={
                query.trim()
                  ? `No archived task matches "${query}".`
                  : 'Tasks archived from cards or cleared columns appear here and can be restored anytime.'
              }
            />
          )}

          {filteredTasks.map((task) => (
            <ArchiveRow
              key={task.id}
              task={task}
              columns={columns}
              projectLabel={projectLabel(task.projectId, task.projectName)}
              onRestore={(taskId) => void restore(taskId)}
              onDeleteForever={(taskId) => void archive.deleteForever(taskId)}
            />
          ))}
        </div>
      </ScrollArea>
    </Drawer>
  );
};
