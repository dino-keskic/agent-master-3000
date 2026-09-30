import React, { useCallback, useMemo, useRef } from 'react';
import { BoardTask } from '../../shared/types';
import { listBackgroundTasks } from '../../shared/agent/backgroundTasks';
import { activityCounts, boardSessionActivity } from '../../shared/task/sessions';
import { collectBoardComments, countBoardComments } from '../../shared/review/boardComments';
import { desktopAlertWarning } from '../../shared/notifications/delivery';
import { setupSeverity } from '../../shared/setup/report';
import { useBoardData } from './useBoardData';
import { useBoardNotifications } from './notifications/useBoardNotifications';
import { useBoardOverlays } from './useBoardOverlays';
import { useBoardSettings } from './useBoardSettings';
import { useProjectFilter } from './useProjectFilter';
import { useTaskViewFilter } from './useTaskViewFilter';
import { useOnboarding } from './useOnboarding';
import { useOpenTasks } from './useOpenTasks';
import { useTaskActions } from './useTaskActions';
import { BoardOverlays } from './BoardOverlays';
import { Header } from '../components/header/Header';
import { KanbanBoard } from '../components/board/KanbanBoard';
import { BoardLoadingScreen } from '../components/loading/BoardLoadingScreen';
import { useBoardLoadState } from '../components/loading/useBoardLoadState';
import { ProjectFilterBar } from '../components/header/ProjectFilterBar';
import { WelcomeScreen } from '../components/onboarding/WelcomeScreen';
import { ConfigStaleNotice } from '../components/setup/ConfigStaleNotice';
import { useSetup } from '../components/setup/useSetup';

/**
 * The board.
 *
 * What it holds itself is only what the user is looking at: which overlays are
 * open and where the keyboard is. Everything else is a hook under `board/` —
 * the data and the live feed, the open task, the actions, the inbox, the
 * project filter — so this file stays the one place that says how the parts
 * are arranged on screen.
 */

export const App: React.FC = () => {
  const board = useBoardData();
  const { tasks, projects, settings, models, agents } = board;

  const selection = useOpenTasks(tasks, board.applySnapshot);
  const filter = useProjectFilter(tasks, projects);
  const view = useTaskViewFilter(filter.visibleTasks);
  const boardSettings = useBoardSettings(board);
  const setup = useSetup();
  const overlays = useBoardOverlays(() => void board.refreshSpend(), setup.reload);
  const actions = useTaskActions({
    columns: settings.columns,
    applySnapshot: board.applySnapshot,
    removeTasks: board.removeTasks,
    refresh: board.refresh
  });

  const sessionCounts = useMemo(() => activityCounts(boardSessionActivity(tasks)), [tasks]);
  const notifications = useBoardNotifications({
    tasks,
    awaitingCount: sessionCounts.awaiting,
    settings: settings.notifications,
    updateSettings: boardSettings.updateSettings,
    onOpenTask: selection.open,
    openTaskIds: selection.openTaskIds
  });

  // A task typed into the header is what you are about to watch, so it opens
  // as soon as the server has made it.
  const { createTask } = actions;
  const { select } = selection;
  const createAndOpenTask = useCallback(
    async (input: Partial<BoardTask>, startImmediately?: boolean) => {
      select(await createTask(input, startImmediately));
    },
    [createTask, select]
  );

  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const load = useBoardLoadState(board);
  const onboarding = useOnboarding(board.hasLoaded, projects, tasks, settings.selectedProjectId);

  const backgroundTaskCount = useMemo(() => listBackgroundTasks(tasks).length, [tasks]);
  const openCommentsCount = useMemo(() => {
    return countBoardComments(collectBoardComments(tasks)).open;
  }, [tasks]);
  const columnTaskCounts = useMemo(
    () => tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.columnId] = (acc[task.columnId] || 0) + 1;
      return acc;
    }, {}),
    [tasks]
  );

  /** A session pinned from the live bar, or just imported: on the board, and open. */
  const showArrivedTask = (task: BoardTask) => {
    board.applySnapshot(task);
    selection.select(task);
  };

  // Before the first load there is nothing to arrange: an empty kanban with
  // "No tasks" under every column is a lie about the board, not a loading
  // state. A dropped socket after that is *not* this branch — `showBoard`
  // stays true and the header's indicator carries it. The first frames render
  // the bare canvas rather than the screen, so a load that beats
  // `LOADING_REVEAL_MS` (the usual case against a local server) never flashes
  // a spinner; holding a minimum instead would delay a board that is ready.
  if (!load.showBoard) {
    if (!load.showLoadingScreen) return <div className="min-h-screen bg-canvas" />;
    return <BoardLoadingScreen state={load} onRetry={() => void board.refresh()} />;
  }

  // A board with nothing on it asks where to work before it shows itself.
  if (onboarding.showing) {
    return (
      <WelcomeScreen
        setup={setup}
        locationsConfirmed={onboarding.locationsConfirmed}
        onConfirmLocations={onboarding.confirmLocations}
        project={onboarding.project}
        isPickingFolder={boardSettings.isPickingFolder}
        onPickFolder={boardSettings.pickProjectFolder}
        onAddFolder={boardSettings.addProject}
        onImport={(project) => {
          onboarding.finish();
          overlays.sessionImport.openFor(project.id);
        }}
        onFinish={onboarding.finish}
      />
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col font-sans">
      <Header
        settings={settings}
        projects={projects}
        models={models}
        agents={agents}
        connection={load.phase}
        onUpdateSettings={boardSettings.updateSettings}
        onPickProjectFolder={boardSettings.pickProjectFolder}
        onOpenSessionImport={overlays.sessionImport.open}
        onOpenColumnEditor={overlays.columnEditor.open}
        onOpenNotifications={notifications.openPanel}
        onOpenSpend={overlays.spend.open}
        onOpenArchive={overlays.archive.open}
        onOpenSettings={overlays.settings.open}
        setupSeverity={setup.report ? setupSeverity(setup.report.locations) : 'ok'}
        onOpenComments={overlays.comments.open}
        openCommentsCount={openCommentsCount}
        weekSpend={board.spend?.week.cost}
        spendReady={board.spend != null}
        unreadNotificationCount={notifications.unread}
        awaitingSessionCount={sessionCounts.awaiting}
        backgroundTaskCount={backgroundTaskCount}
        desktopAlertWarning={desktopAlertWarning(notifications.alertState)}
        onDeleteProject={boardSettings.deleteProject}
        onCreateTask={createAndOpenTask}
        promptInputRef={promptInputRef}
      />

      <main className="flex-1 max-w-[2200px] w-full mx-auto p-7" id="board">
        {board.configStale && <ConfigStaleNotice onRestarted={() => void board.refresh()} />}
        <ProjectFilterBar
          chips={filter.chips}
          total={tasks.length}
          filtered={filter.isFiltered}
          onToggle={filter.toggle}
          onClear={filter.clear}
          updatedToday={view.updatedToday}
          changedFiles={view.changedFiles}
          onToggleUpdatedToday={view.toggleUpdatedToday}
          onToggleChangedFiles={view.toggleChangedFiles}
        />

        <KanbanBoard
          tasks={view.visibleTasks}
          changes={view.changes}
          columns={settings.columns}
          onSelectTask={selection.select}
          onMoveTask={actions.moveTask}
          onArchiveTask={actions.archiveTask}
          onClearColumn={actions.clearColumn}
          onStopTask={actions.stopTask}
          onRunTask={actions.runTask}
          onFocusPromptInput={() => promptInputRef.current?.focus()}
        />
      </main>

      <BoardOverlays
        board={board}
        overlays={overlays}
        notifications={notifications}
        selection={selection}
        actions={actions}
        boardSettings={boardSettings}
        setup={setup}
        columnTaskCounts={columnTaskCounts}
        changes={view.changes}
        onTaskArrived={showArrivedTask}
      />
    </div>
  );
};
