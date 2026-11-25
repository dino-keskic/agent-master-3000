import React from 'react';
import { Modal } from '@mantine/core';
import { History } from 'lucide-react';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { SessionFilterTab } from '../../../shared/sessions/import';
import { Chip } from '../ui';
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
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-acc-bg border border-acc-bd flex items-center justify-center text-acc-fg shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold text-ink">OpenCode Sessions</span>
              <Chip tone="accent" className="font-mono">
                {list.total} session{list.total === 1 ? '' : 's'}
              </Chip>
            </div>
            <span className="text-[11.5px] text-ink-3">
              Search, filter, and import historical or active sessions onto your board
            </span>
          </div>
        </div>
      }
      styles={{
        content: {
          backgroundColor: 'var(--glass-pane)',
          color: 'rgb(var(--c-ink))',
          maxWidth: '1200px'
        },
        header: {
          backgroundColor: 'rgb(var(--c-surface))',
          borderBottom: '1px solid rgb(var(--c-line))',
          padding: '14px 20px'
        },
        body: { padding: '16px 20px 20px 20px' }
      }}
    >
      <div className="flex flex-col gap-3.5">
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
      </div>
    </Modal>
  );
};
