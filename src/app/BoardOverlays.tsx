import React from 'react';
import { BoardColumn, BoardTask } from '../../shared/types';
import { TaskChangeSummary } from '../../shared/git/changeSummary';
import { BoardData } from './useBoardData';
import { BoardNotifications } from './notifications/useBoardNotifications';
import { BoardOverlayState } from './useBoardOverlays';
import { BoardSettingsActions } from './useBoardSettings';
import { OpenTasks } from './useOpenTasks';
import { TaskActions } from './useTaskActions';
import { ColumnEditorModal } from '../components/columns/ColumnEditorModal';
import { NotificationPanel } from '../components/notifications/NotificationPanel';
import { SessionImportModal } from '../components/import/SessionImportModal';
import { SpendPanel } from '../components/spend/SpendPanel';
import { TaskWorkspace } from '../components/split/TaskWorkspace';
import { ArchivePanel } from '../components/archive/ArchivePanel';
import { ReviewNotesDrawer } from '../components/notes/ReviewNotesDrawer';
import { SettingsModal } from '../components/setup/SettingsModal';
import { Setup } from '../components/setup/useSetup';

/**
 * Everything that opens over the board. None of it is on screen at rest, and
 * all of it is wired to the same board hooks — so it is arranged here rather
 * than doubling the length of `App`.
 */

interface BoardOverlaysProps {
  board: BoardData;
  overlays: BoardOverlayState;
  notifications: BoardNotifications;
  selection: OpenTasks;
  actions: TaskActions;
  boardSettings: BoardSettingsActions;
  setup: Setup;
  /** How many tasks each column holds, so the editor can warn before a delete. */
  columnTaskCounts: Record<string, number>;
  /** What each task on the board has changed on disk, for the Changes tab's badge. */
  changes: Record<string, TaskChangeSummary>;
  /** A session just imported: put it on the board and open it. */
  onTaskArrived: (task: BoardTask) => void;
}

export const BoardOverlays: React.FC<BoardOverlaysProps> = ({
  board,
  overlays,
  notifications,
  selection,
  actions,
  boardSettings,
  setup,
  columnTaskCounts,
  changes,
  onTaskArrived
}) => {
  const { settings, projects, models, agents } = board;

  return (
    <>
      <SessionImportModal
        isOpen={overlays.sessionImport.opened}
        projects={projects}
        initialProjectId={overlays.sessionImport.projectId}
        onClose={overlays.sessionImport.close}
        onImported={onTaskArrived}
      />

      <ColumnEditorModal
        opened={overlays.columnEditor.opened}
        columns={settings.columns}
        models={models}
        agents={agents}
        taskCounts={columnTaskCounts}
        onClose={overlays.columnEditor.close}
        onSave={(columns: BoardColumn[]) => void boardSettings.updateSettings({ columns })}
      />

      <NotificationPanel
        opened={notifications.isPanelOpen}
        onClose={notifications.closePanel}
        tasks={board.tasks}
        columns={settings.columns}
        inbox={notifications.inbox}
        permission={notifications.permission}
        settings={settings}
        onUpdateSettings={boardSettings.updateSettings}
        onOpenSession={notifications.openSession}
        onRespond={actions.respond}
        onMarkRead={notifications.markRead}
        onMarkAllRead={notifications.markAllRead}
        onDismiss={notifications.dismiss}
        onClear={notifications.clear}
        onEnableDesktop={notifications.enableDesktop}
        onTestDesktop={notifications.testDesktop}
      />

      <SpendPanel
        opened={overlays.spend.opened}
        onClose={overlays.spend.close}
        summary={board.spend}
        loading={board.isSpendLoading}
        onRefresh={() => void board.refreshSpend(true)}
      />

      <ArchivePanel
        opened={overlays.archive.opened}
        onClose={overlays.archive.close}
        columns={settings.columns}
        projects={projects}
        onRestore={actions.restoreTask}
      />

      <SettingsModal opened={overlays.settings.opened} onClose={overlays.settings.close} setup={setup} />

      <ReviewNotesDrawer
        opened={overlays.comments.opened}
        onClose={overlays.comments.close}
        tasks={board.tasks}
        onSelectTask={(task) => {
          selection.select(task);
        }}
        onApplyTask={board.applySnapshot}
      />

      <TaskWorkspace
        open={selection}
        boardTasks={board.tasks}
        columns={settings.columns}
        models={models}
        agents={agents}
        projects={projects}
        actions={actions}
        changes={changes}
        onApplyTask={board.applySnapshot}
      />
    </>
  );
};
