import React, { useCallback, useMemo, useState } from 'react';
import { useMantineColorScheme } from '@mantine/core';
import { BoardTask } from '../../shared/types';
import { activityCounts, boardSessionActivity } from '../../shared/task/sessions';
import { collectBoardComments, countBoardComments } from '../../shared/review/boardComments';
import { desktopAlertWarning } from '../../shared/notifications/delivery';
import { attentionItems } from '../../shared/attention/attention';
import { setupSeverity } from '../../shared/setup/report';
import { useBoardData } from './useBoardData';
import { useBoardKeys } from './useBoardKeys';
import { useBoardNotifications } from './notifications/useBoardNotifications';
import { useBoardOverlays } from './useBoardOverlays';
import { useBoardSettings } from './useBoardSettings';
import { useProjectFilter } from './useProjectFilter';
import { useTaskViewFilter } from './useTaskViewFilter';
import { useOnboarding } from './useOnboarding';
import { useOpenTasks } from './useOpenTasks';
import { useManager } from './useManager';
import { useTaskActions } from './useTaskActions';
import { BoardOverlays } from './BoardOverlays';
import { Header } from '../components/header/Header';
import { useNewTaskDraft } from '../components/header/useNewTaskDraft';
import { CommandPalette } from '../components/palette/CommandPalette';
import { usePalette } from '../components/palette/usePalette';
import { KanbanBoard } from '../components/board/KanbanBoard';
import { BoardLoadingScreen } from '../components/loading/BoardLoadingScreen';
import { useBoardLoadState } from '../components/loading/useBoardLoadState';
import { NewTaskSheet } from '../components/header/NewTaskSheet';
import { NeedsYouStrip } from '../components/attention/NeedsYouStrip';
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
  const { projects, settings, models, agents } = board;

  // The drawer and the notifications see every task; the kanban and its counts
  // see every task but the manager, which has a button of its own.
  const selection = useOpenTasks(board.tasks, board.applySnapshot);
  const manager = useManager(board.tasks, board.applySnapshot, selection.select);
  const tasks = manager.boardTasks;
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

  const sessionCounts = useMemo(() => activityCounts(boardSessionActivity(board.tasks)), [board.tasks]);
  const notifications = useBoardNotifications({
    tasks: board.tasks,
    awaitingCount: sessionCounts.awaiting,
    settings: settings.notifications,
    updateSettings: boardSettings.updateSettings,
    onOpenTask: selection.open,
    openTaskIds: selection.openTaskIds
  });

  // A task you just wrote is what you are about to watch, so it opens
  // as soon as the server has made it.
  const { createTask } = actions;
  const { select } = selection;
  const createAndOpenTask = useCallback(
    async (input: Partial<BoardTask>, startImmediately?: boolean) => {
      select(await createTask(input, startImmediately));
    },
    [createTask, select]
  );

  // One draft for both ways in: the new-task sheet, and a line typed into the
  // palette, which lands with the same defaults in the same place.
  const draft = useNewTaskDraft(settings, projects, createAndOpenTask);
  const palette = usePalette();
  const { toggleColorScheme } = useMantineColorScheme();

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const openNewTask = useCallback(() => setNewTaskOpen(true), []);

  // A panel over the board owns the keyboard, and so does the manager's chat,
  // which is open but is not one of the tasks the walk moves through.
  const openTaskId = selection.focusedId ?? selection.openTaskIds[0];
  const focusedTaskId = useBoardKeys({
    tasks: view.visibleTasks,
    listed: tasks,
    columns: settings.columns,
    openTaskId,
    blocked:
      palette.opened ||
      newTaskOpen ||
      notifications.isPanelOpen ||
      Object.values(overlays).some((overlay) => overlay.opened) ||
      (!!openTaskId && !tasks.some((task) => task.id === openTaskId)),
    onOpen: selection.select,
    onNewTask: openNewTask
  });

  // The manager has a button of its own, so what it wants is not listed here.
  const attention = useMemo(() => attentionItems(tasks, notifications.inbox), [tasks, notifications.inbox]);
  const load = useBoardLoadState(board);
  const onboarding = useOnboarding(board.hasLoaded, projects, tasks, settings.selectedProjectId);

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
    if (!load.showLoadingScreen) return <div className="min-h-screen" />;
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
    <div className="min-h-screen text-ink flex flex-col font-sans">
      <Header
        connection={load.phase}
        chips={filter.chips}
        taskCount={tasks.length}
        onToggleProject={filter.toggle}
        onClearProjects={filter.clear}
        updatedToday={view.updatedToday}
        changedFiles={view.changedFiles}
        onToggleUpdatedToday={view.toggleUpdatedToday}
        onToggleChangedFiles={view.toggleChangedFiles}
        onOpenPalette={palette.open}
        onNewTask={openNewTask}
        attentionCount={attention.length}
        desktopAlertWarning={desktopAlertWarning(notifications.alertState)}
        unreadNotificationCount={notifications.unread}
        onOpenNotifications={notifications.openPanel}
        managerState={manager.state}
        onOpenManager={manager.open}
        weekSpend={board.spend?.week.cost}
        spendReady={board.spend != null}
        onOpenSpend={overlays.spend.open}
        openCommentsCount={openCommentsCount}
        setupSeverity={setup.report ? setupSeverity(setup.report.locations) : 'ok'}
        onOpenComments={overlays.comments.open}
        onOpenColumnEditor={overlays.columnEditor.open}
        onOpenArchive={overlays.archive.open}
        onOpenSessionImport={overlays.sessionImport.open}
        onOpenSettings={overlays.settings.open}
      />

      <main className="flex-1 max-w-[2200px] w-full mx-auto px-5 pt-5" id="board">
        {board.configStale && <ConfigStaleNotice onRestarted={() => void board.refresh()} />}
        <NeedsYouStrip
          items={attention}
          onOpen={notifications.openSession}
          onRespond={actions.respond}
          onDismiss={notifications.dismiss}
        />

        {tasks.length > 0 && view.visibleTasks.length === 0 && (
          <div className="board-empty" role="status">
            <span>None of the {tasks.length} tasks on the board match the filters.</span>
            <button
              type="button"
              className="hdr-btn h-7 px-2.5 text-[12px]"
              onClick={() => {
                filter.clear();
                if (view.updatedToday.selected) view.toggleUpdatedToday();
                if (view.changedFiles.selected) view.toggleChangedFiles();
              }}
            >
              Show everything
            </button>
          </div>
        )}

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
          onNewTask={openNewTask}
          defaultModel={settings.defaultModel}
          defaultAgent={settings.defaultAgent}
          focusedTaskId={focusedTaskId}
        />
      </main>

      {palette.opened && (
        <CommandPalette
          tasks={tasks}
          columns={settings.columns}
          createHint={[
            draft.runsOnCreate ? 'Dispatch an agent' : `Queue to ${draft.firstColumnTitle || 'Backlog'}`,
            draft.project?.name
          ].filter(Boolean).join(' · ')}
          onClose={palette.close}
          onOpenTask={selection.select}
          onOpenTaskBeside={selection.openBeside}
          onCreateTask={(text) => void draft.create(text)}
          onNewTask={openNewTask}
          onOpenManager={() => void manager.open()}
          onOpenSpend={overlays.spend.open}
          onOpenNotifications={notifications.openPanel}
          onOpenComments={overlays.comments.open}
          onOpenColumnEditor={overlays.columnEditor.open}
          onOpenArchive={overlays.archive.open}
          onOpenSessionImport={overlays.sessionImport.open}
          onOpenSettings={overlays.settings.open}
          onToggleTheme={toggleColorScheme}
        />
      )}

      <NewTaskSheet
        opened={newTaskOpen}
        onClose={() => setNewTaskOpen(false)}
        settings={settings}
        projects={projects}
        models={models}
        agents={agents}
        draft={draft}
        onUpdateSettings={boardSettings.updateSettings}
        onPickProjectFolder={boardSettings.pickProjectFolder}
        onDeleteProject={boardSettings.deleteProject}
      />

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
