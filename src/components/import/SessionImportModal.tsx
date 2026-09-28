import React from 'react';
import { Badge, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { History } from 'lucide-react';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { SessionFilterTab } from '../../../shared/sessions/import';
import { SessionSearchBar } from './SessionSearchBar';
import { SessionFilterTabs } from './SessionFilterTabs';
import { SessionResultList } from './SessionResultList';
import { SessionImportFooter } from './SessionImportFooter';
import { useSessionImport } from './useSessionImport';
import { useSessionList } from './useSessionList';

interface SessionImportModalProps {
  isOpen: boolean;
  projects: ProjectFolder[];
  initialFilter?: SessionFilterTab;
  /** Opens narrowed to this project instead of wherever it was left. */
  initialProjectId?: string;
  onClose: () => void;
  onImported: (task: BoardTask) => void | Promise<void>;
}

/**
 * Bringing existing OpenCode sessions onto the board.
 *
 * The work already happened somewhere else; importing is what gives it a card.
 * `useSessionList` finds the sessions, `useSessionImport` moves the ones the
 * user picked, and the pieces under `import/` show them.
 */
export const SessionImportModal: React.FC<SessionImportModalProps> = ({
  isOpen,
  projects,
  initialFilter = 'all',
  initialProjectId,
  onClose,
  onImported
}) => {
  const list = useSessionList(isOpen, projects, initialFilter, initialProjectId);
  const picked = useSessionImport(isOpen, list.visible, onImported, onClose, list.refresh);

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      size="85%"
      centered
      title={
        <Group gap="sm">
          <Paper p={6} bg="accent.9" radius="md">
            <History className="w-5 h-5 text-accent" />
          </Paper>
          <Stack gap={0}>
            <Group gap="xs" align="center">
              <Text fw={700} size="md" className="text-ink">
                OpenCode Sessions
              </Text>
              <Badge size="xs" color="accent" variant="light" className="font-mono">
                {list.total} session{list.total === 1 ? '' : 's'}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" className="font-mono text-[11px]">
              Search, browse, and import historical or active sessions onto your Agent Master 3000
            </Text>
          </Stack>
        </Group>
      }
      styles={{
        content: {
          backgroundColor: 'rgb(var(--c-surface))',
          color: 'rgb(var(--c-ink))',
          border: '1px solid rgb(var(--c-line))',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
          maxWidth: '1200px'
        },
        header: {
          backgroundColor: 'rgb(var(--c-surface-3))',
          borderBottom: '1px solid rgb(var(--c-line))',
          padding: '14px 20px'
        },
        body: { padding: '16px 20px 20px 20px' }
      }}
    >
      <Stack gap="md">
        <SessionSearchBar
          query={list.query}
          onQueryChange={list.setQuery}
          projects={projects}
          projectId={list.projectId}
          onProjectChange={list.setProjectId}
          sortBy={list.sortBy}
          onSortChange={list.setSortBy}
          isLoading={list.isLoading}
          onRefresh={list.refresh}
        />

        <SessionFilterTabs
          tab={list.tab}
          counts={list.counts}
          onTabChange={list.setTab}
          untitledCount={list.untitledCount}
          showUntitled={list.showUntitled}
          onShowUntitledChange={list.setShowUntitled}
          showRemoved={list.showRemoved}
          onShowRemovedChange={list.setShowRemoved}
        />

        <SessionResultList
          sessions={list.visible}
          isLoading={list.isLoading}
          error={list.error}
          query={list.query}
          grouped={list.sortBy === 'recent'}
          selected={picked.selected}
          importingId={picked.importingId}
          bulkActive={!!picked.progress}
          onToggle={picked.toggle}
          onImport={(session) => void picked.importOne(session)}
        />

        <SessionImportFooter
          shown={list.visible.length}
          total={list.total}
          projectCount={projects.length}
          progress={picked.progress}
          selectedCount={picked.selected.size}
          selectableCount={picked.selectableCount}
          allSelected={picked.allSelected}
          busy={!!picked.importingId}
          onToggleAll={picked.toggleAll}
          onImport={() => void picked.importSelected()}
        />
      </Stack>
    </Modal>
  );
};
