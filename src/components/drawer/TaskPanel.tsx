import React, { useCallback, useRef, useState } from 'react';
import { Drawer, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { PanelRight } from 'lucide-react';
import { TaskSidebar } from '../sidebar/TaskSidebar';
import { DrawerTitleBar } from './DrawerTitleBar';
import { DrawerMainPane } from './DrawerMainPane';
import { DrawerSessionModal } from './DrawerSessionModal';
import { MoveWorkModal } from '../worktree/MoveWorkModal';
import { RemoteAccessPopover } from '../remote/RemoteAccessPopover';
import { SplitPicker } from '../split/SplitPicker';
import { ResizeHandle } from '../ui/ResizeHandle';
import { useNow } from '../ui/useNow';
import { usePanelWidth } from '../ui/usePanelWidth';
import { useDrawerData } from './useDrawerData';
import { useDrawerState } from './useDrawerState';
import { useStoredFlag } from './useStoredFlag';
import { drawerActions } from './drawerActions';
import { usePendingPrompts } from './usePendingPrompts';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { formatDuration, liveLastTurnDurationMs, liveSessionDurationMs } from '../../../shared/sessions/duration';
import { BoardColumn, BoardTask, PermissionAnswer, ProjectFolder, PromptImage } from '../../../shared/types';
import { MAX_PANES } from '../../../shared/board/splitLayout';
import { TASK_SIDEBAR_BOUNDS, resizedWidth } from '../../../shared/board/panelResize';
import { MOBILE_BREAKPOINT_PX, showBackInPanelHeader, sidebarPresentation } from '../../../shared/board/viewport';
import { sessionCwd, taskSessionViews } from '../../../shared/task/sessions';
import { resolveViewedSession, transcriptPending } from '../../../shared/task/viewedSession';
import { blankSessionPending, drawerTranscript } from '../../../shared/task/drawerTranscript';
import { queuedForSession } from '../../../shared/turns/queue';
import { isManagerTask } from '../../../shared/manager/identity';
import { managerTranscript } from '../../../shared/manager/transcript';

interface TaskPanelProps {
  task: BoardTask;
  /** Session to show on open, when the panel was opened from the activity panel. */
  focusSessionId: string | null;
  onFocusHandled: (taskId: string) => void;
  /** Every task on the board, for "open beside". */
  boardTasks: BoardTask[];
  openTaskIds: string[];
  /** Whether other panels share the workspace, and whether this one has the focus. */
  split: boolean;
  focused: boolean;
  /** True when the left WorkRail is hidden so this header owns the Back button. */
  narrowWorkspace?: boolean;
  onBack?: () => void;
  onFocus: (taskId: string) => void;
  onOpenBeside: (taskId: string, anchorId: string) => void;
  onClose: (taskId: string) => void;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  projects: ProjectFolder[];
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  onSendPrompt: (taskId: string, prompt: string, images?: PromptImage[]) => Promise<boolean>;
  onStopTask: (taskId: string) => void | Promise<void>;
  onStopSession: (taskId: string, sessionId: string) => void | Promise<void>;
  onRespond: (taskId: string, answer: PermissionAnswer) => void | Promise<void>;
  onMoveTask: (taskId: string, columnId: string) => void | Promise<void>;
  /** How many files the task has changed, for the Changes tab's badge. */
  changedFiles: number;
  /** Fold a server snapshot into board state (comment writes, etc.). */
  onApplyTask?: (task: BoardTask) => void;
}

/**
 * One task, one of its sessions at a time: a panel of the split workspace.
 *
 * The panel decides *which* conversation is on screen and what the user can do
 * to it; the pieces under `drawer/` render the parts of that decision, and
 * `resolveViewedSession` works out what the view actually is. Where the panel
 * sits and how many there are is `TaskWorkspace`'s business.
 */
export const TaskPanel: React.FC<TaskPanelProps> = ({
  task,
  focusSessionId,
  onFocusHandled,
  boardTasks,
  openTaskIds,
  split,
  focused,
  narrowWorkspace = false,
  onBack,
  onFocus,
  onOpenBeside,
  onClose,
  columns,
  models,
  agents,
  projects,
  onUpdateTask,
  onRunTask,
  onSendPrompt,
  onStopTask,
  onStopSession,
  onRespond,
  onMoveTask,
  changedFiles,
  onApplyTask
}) => {
  const focusHandled = useCallback(() => onFocusHandled(task.id), [onFocusHandled, task.id]);
  const state = useDrawerState(task, focusSessionId, focusHandled);
  const sessionId = state.activeSessionId || task.activeSessionId || task.sessionId;
  const { editors, primaryEditor, subagents, sideSessionLogs } = useDrawerData(
    task.id,
    task.subagentCount,
    sessionId,
    task.runState === 'running'
  );
  // The details are about the task, not the conversation, so they wait behind
  // a toggle and the transcript gets the width. Mobile always keeps them in an
  // ephemeral slide-over drawer so the transcript fills phone screens cleanly.
  const isMobile = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`) ?? false;
  const [sidebarOpen, toggleSidebar] = useStoredFlag('agentMasterTaskDetails');
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sidebar = usePanelWidth('agentMasterTaskSidebarWidth', TASK_SIDEBAR_BOUNDS);
  const sidebarDragStart = useRef(sidebar.width);

  const view = resolveViewedSession(task, sessionId, subagents);
  const now = useNow(view.runState === 'running');
  const timingTarget = view.viewed ?? task;
  const totalDurationLabel = formatDuration(liveSessionDurationMs(timingTarget, now));
  const lastTurnDurationMs = liveLastTurnDurationMs(timingTarget, now);
  const runningDurationLabel =
    view.runState === 'running' ? formatDuration(lastTurnDurationMs ?? liveSessionDurationMs(timingTarget, now)) : undefined;
  const lastTurnDurationLabel = view.runState === 'running' ? undefined : formatDuration(lastTurnDurationMs);
  const viewedCwd = sessionCwd(task, view.viewed);
  const fetchedLogs = sessionId ? sideSessionLogs[sessionId] : undefined;
  const startingBlank = blankSessionPending(task, state.blankStart);
  // The manager is a conversation about the board, not a card on it: no
  // column, no diff, and its briefing is not something the user said.
  const manager = isManagerTask(task);
  const transcript = drawerTranscript(task, sessionId, fetchedLogs, state.blankStart);
  const logs = manager ? managerTranscript(transcript) : transcript;
  const pending = usePendingPrompts({
    sessionId,
    logs,
    queued: queuedForSession(task, sessionId),
    runState: view.runState
  });

  const handleSaveTitle = () => {
    const title = state.editedTitle.trim();
    state.setIsEditingTitle(false);
    if (!title || title === task.title) return;
    // Single write path: the parent owns the request and the resulting state.
    void onUpdateTask(task.id, { title });
  };

  const actions = drawerActions({
    task,
    sessionId,
    cwd: viewedCwd,
    onViewSession: state.viewSession,
    onStartBlank: state.startBlank,
    onCancelBlank: state.cancelBlank,
    onClearComposer: () => state.setPromptText(''),
    onClearForkAnchor: () => state.setForkAnchor(null),
    setCompacting: state.setIsCompacting,
    onSendPrompt,
    busy: view.busy,
    pending,
    onStopSession,
    onStopTask
  });

  // One click is one session: the button waits for the server to take it.
  const [startingSession, setStartingSession] = useState(false);
  const startNewSession = () => {
    if (startingSession) return;
    setStartingSession(true);
    void actions.startNewSession().finally(() => setStartingSession(false));
  };

  const openForkModal = (sourceId?: string) => {
    state.setForkSourceSessionId(sourceId);
    state.setSessionModalMode('fork');
  };

  // Escape first cancels an active fork anchor, otherwise closes the panel.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (e.target instanceof Element && e.target.getAttribute('data-mantine-stop-propagation') === 'true') return;
    if (state.forkAnchor) {
      e.preventDefault();
      state.setForkAnchor(null);
      return;
    }
    onClose(task.id);
  };

  // Agents and Skills tabs each render their own 2-pane studio, so hiding the
  // task metadata sidebar there prevents cramping four side-by-side columns.
  const isStudioTab = state.tab === 'agents' || state.tab === 'skills';
  const sidebarMode = sidebarPresentation(isMobile, sidebarOpen, mobileDetailsOpen, isStudioTab);
  const detailsActive = isMobile ? mobileDetailsOpen : sidebarOpen;
  const handleToggleDetails = () => {
    if (isMobile) setMobileDetailsOpen((open) => !open);
    else toggleSidebar();
  };

  const renderSidebar = (width: number | string, closeOnSwitch: boolean) => (
    <TaskSidebar
      task={task}
      activeSessionId={sessionId}
      viewedCwd={viewedCwd}
      width={width}
      subagents={subagents}
      onSwitchSession={(id) => {
        actions.selectSession(id);
        if (closeOnSwitch) setMobileDetailsOpen(false);
      }}
      onStartFork={openForkModal}
      onStartNewSession={startNewSession}
      startingSession={startingSession}
      onStopSession={actions.stopSession}
      onPromoteSession={actions.promoteSession}
      projects={projects}
      onRequestMove={(id) => {
        if (closeOnSwitch) setMobileDetailsOpen(false);
        state.setMoving(id ?? null);
      }}
      editors={editors}
      primaryEditor={primaryEditor}
      onOpenFolder={actions.openPath}
      onTaskUpdated={(updated) => onApplyTask?.(updated)}
    />
  );

  return (
    <section
      className="flex-1 flex flex-col min-w-0 min-h-0"
      aria-label={`${task.id} ${task.title}`}
      onPointerDownCapture={() => onFocus(task.id)}
      onFocusCapture={() => onFocus(task.id)}
      onKeyDown={handleKeyDown}
    >
      <header
        className={`bg-[var(--session-rail)] border-b border-line min-h-[44px] sm:h-[44px] px-2.5 sm:px-3.5 py-1.5 sm:py-0 pt-[max(6px,env(safe-area-inset-top))] sm:pt-0 flex items-center border-t-2 shrink-0 ${
          split && focused ? 'border-t-accent' : 'border-t-transparent'
        }`}
      >
        <DrawerTitleBar
          taskId={manager ? undefined : task.id}
          columns={manager ? undefined : columns}
          columnId={manager ? undefined : task.columnId}
          onMoveColumn={manager ? undefined : (columnId) => void onMoveTask(task.id, columnId)}
          runState={view.runState}
          runningDurationLabel={runningDurationLabel}
          lastTurnDurationLabel={lastTurnDurationLabel}
          totalDurationLabel={totalDurationLabel}
          title={task.title}
          editing={state.isEditingTitle}
          draftTitle={state.editedTitle}
          onDraftTitleChange={state.setEditedTitle}
          onStartEditing={() => state.setIsEditingTitle(true)}
          onCancelEditing={() => state.setIsEditingTitle(false)}
          onSaveTitle={handleSaveTitle}
          showBack={showBackInPanelHeader(narrowWorkspace)}
          onBack={onBack ?? (() => onClose(task.id))}
          showClose={split}
          onClose={() => onClose(task.id)}
          closeLabel={split ? 'Close this panel' : 'Back to the board'}
          controls={
            <>
              {!manager && (
                <div className="hidden sm:flex items-center gap-0.5">
                  <RemoteAccessPopover taskId={task.id} sessionId={sessionId} />
                  <SplitPicker
                    tasks={boardTasks}
                    openTaskIds={openTaskIds}
                    atCap={openTaskIds.length >= MAX_PANES}
                    onPick={(id) => onOpenBeside(id, task.id)}
                  />
                </div>
              )}
              {!isStudioTab && (
                <Tooltip label={detailsActive ? 'Hide task details' : 'Show task details'} withArrow>
                  <button
                    type="button"
                    className={`icon-btn w-8 h-8 sm:w-7 sm:h-7 relative${detailsActive ? ' is-on' : ''}`}
                    aria-label={detailsActive ? 'Hide task details' : 'Show task details'}
                    aria-pressed={detailsActive}
                    onClick={handleToggleDetails}
                  >
                    <PanelRight className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                    {isMobile && view.sessions.length > 1 && (
                      <span
                        className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-accent"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </Tooltip>
              )}
            </>
          }
        />
      </header>

      <div ref={bodyRef} className="flex-1 flex min-h-0 min-w-0 overflow-hidden w-full">
        <DrawerMainPane
          task={task}
          conversationOnly={manager}
          sessionId={sessionId}
          view={view}
          sidebarOpen={sidebarMode === 'inline'}
          logs={logs}
          pendingPrompts={pending.shown}
          queuingPrompts={pending.queuing}
          awaitingTranscript={!startingBlank && transcriptPending(task, view, fetchedLogs)}
          viewedCwd={viewedCwd}
          folderGone={task.cwdExists === false}
          state={state}
          actions={actions}
          primaryEditor={primaryEditor}
          changedFiles={changedFiles}
          columns={columns}
          models={models}
          agents={agents}
          onApplyTask={onApplyTask}
          onRespond={onRespond}
          onRunTask={onRunTask}
          onUpdateTask={onUpdateTask}
        />

        {sidebarMode === 'inline' && (
          <>
            <ResizeHandle
              label="Resize details sidebar"
              onDragStart={() => {
                sidebarDragStart.current = sidebar.width;
              }}
              onDragMove={(deltaX) => {
                const containerWidth = bodyRef.current?.clientWidth;
                sidebar.setWidth(
                  resizedWidth(sidebarDragStart.current, deltaX, 'left', TASK_SIDEBAR_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onNudge={(deltaX) => {
                const containerWidth = bodyRef.current?.clientWidth;
                sidebar.setWidth(
                  resizedWidth(sidebar.width, deltaX, 'left', TASK_SIDEBAR_BOUNDS, containerWidth),
                  containerWidth
                );
              }}
              onReset={sidebar.reset}
            />
            {renderSidebar(sidebar.width, false)}
          </>
        )}
      </div>

      {sidebarMode === 'drawer' && (
        <Drawer
          opened
          onClose={() => setMobileDetailsOpen(false)}
          position="right"
          size={340}
          zIndex={220}
          title="Details & sessions"
          styles={{
            content: { backgroundColor: 'var(--session-rail)', color: 'rgb(var(--c-ink))', maxWidth: '90vw' },
            header: {
              backgroundColor: 'var(--session-rail)',
              borderBottom: '1px solid rgb(var(--c-line))',
              paddingTop: 'max(10px, env(safe-area-inset-top))'
            },
            body: {
              padding: 0,
              height: 'calc(100dvh - 54px)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }
          }}
        >
          {renderSidebar('100%', true)}
        </Drawer>
      )}

      {state.moving !== undefined && (
        <MoveWorkModal
          task={task}
          session={taskSessionViews(task).find((s) => s.sessionId === state.moving)}
          projects={projects}
          opened
          onClose={() => state.setMoving(undefined)}
          onMove={actions.moveWork}
        />
      )}

      <DrawerSessionModal
        task={task}
        view={view}
        mode={state.sessionModalMode}
        sourceSessionId={state.forkSourceSessionId}
        onModeChange={(next) => {
          state.setSessionModalMode(next);
          if (!next) state.setForkSourceSessionId(undefined);
        }}
        actions={actions}
        models={models}
        agents={agents}
        projects={projects}
        onUpdateTask={onUpdateTask}
      />
    </section>
  );
};
