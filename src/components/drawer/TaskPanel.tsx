import React, { useCallback, useState } from 'react';
import { Tooltip } from '@mantine/core';
import { PanelRight } from 'lucide-react';
import { TaskSidebar } from '../sidebar/TaskSidebar';
import { DrawerTitleBar } from './DrawerTitleBar';
import { DrawerMainPane } from './DrawerMainPane';
import { DrawerSessionModal } from './DrawerSessionModal';
import { MoveWorkModal } from '../worktree/MoveWorkModal';
import { SplitPicker } from '../split/SplitPicker';
import { useDrawerData } from './useDrawerData';
import { useDrawerState } from './useDrawerState';
import { drawerActions } from './drawerActions';
import { usePendingPrompts } from './usePendingPrompts';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask, PermissionAnswer, ProjectFolder, PromptImage } from '../../../shared/types';
import { MAX_PANES } from '../../../shared/board/splitLayout';
import { sessionCwd, taskSessionViews } from '../../../shared/task/sessions';
import { resolveViewedSession, transcriptPending } from '../../../shared/task/viewedSession';
import { blankSessionPending, drawerTranscript } from '../../../shared/task/drawerTranscript';
import { queuedForSession } from '../../../shared/turns/queue';

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
  expanded: boolean;
  onToggleExpanded: () => void;
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

// The panel's chrome — this header, the footer and the task sidebar — is all
// one `surface`; only the transcript between them sits on the canvas.
const HEADER_STYLE: React.CSSProperties = {
  backgroundColor: 'rgb(var(--c-surface))',
  borderBottom: '1px solid rgb(var(--c-line))',
  padding: '12px 18px',
  minHeight: 60
};

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
  expanded,
  onToggleExpanded,
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
  // Beside other panels the sidebar would leave the transcript a sliver, so it
  // waits behind a toggle; alone, it is always there as it always was.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const showSidebar = !split || sidebarOpen;

  const view = resolveViewedSession(task, sessionId, subagents);
  const viewedCwd = sessionCwd(task, view.viewed);
  const fetchedLogs = sessionId ? sideSessionLogs[sessionId] : undefined;
  const startingBlank = blankSessionPending(task, state.blankStart);
  const logs = drawerTranscript(task, sessionId, fetchedLogs, state.blankStart);
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

  // Escape closes the panel it was pressed in. Anything inside that already
  // used the key — a composer menu, a title edit, a picker — says so by
  // preventing the default, as Mantine's own dropdowns mark themselves.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if ((e.target as HTMLElement).getAttribute?.('data-mantine-stop-propagation') === 'true') return;
    onClose(task.id);
  };

  return (
    <section
      className="flex-1 flex flex-col min-w-0 min-h-0"
      aria-label={`${task.id} ${task.title}`}
      onPointerDownCapture={() => onFocus(task.id)}
      onFocusCapture={() => onFocus(task.id)}
      onKeyDown={handleKeyDown}
    >
      <header
        style={HEADER_STYLE}
        className={`border-t-2 ${split && focused ? 'border-t-accent' : 'border-t-transparent'}`}
      >
        <DrawerTitleBar
          taskId={task.id}
          title={task.title}
          editing={state.isEditingTitle}
          draftTitle={state.editedTitle}
          expanded={split ? undefined : expanded}
          onDraftTitleChange={state.setEditedTitle}
          onStartEditing={() => state.setIsEditingTitle(true)}
          onCancelEditing={() => state.setIsEditingTitle(false)}
          onSaveTitle={handleSaveTitle}
          onToggleExpanded={split ? undefined : onToggleExpanded}
          onClose={() => onClose(task.id)}
          closeLabel={split ? 'Close this panel' : 'Close'}
          controls={
            <>
              <SplitPicker
                tasks={boardTasks}
                openTaskIds={openTaskIds}
                atCap={openTaskIds.length >= MAX_PANES}
                onPick={(id) => onOpenBeside(id, task.id)}
              />
              {split && (
                <Tooltip label={sidebarOpen ? 'Hide task details' : 'Show task details'} withArrow>
                  <button
                    type="button"
                    className={`icon-btn${sidebarOpen ? ' is-on' : ''}`}
                    aria-label={sidebarOpen ? 'Hide task details' : 'Show task details'}
                    aria-pressed={sidebarOpen}
                    onClick={() => setSidebarOpen((open) => !open)}
                  >
                    <PanelRight className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              )}
            </>
          }
        />
      </header>

      <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden w-full">
        <DrawerMainPane
          task={task}
          sessionId={sessionId}
          view={view}
          logs={logs}
          pendingPrompts={pending.shown}
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
          onMoveTask={onMoveTask}
          onRunTask={onRunTask}
          onUpdateTask={onUpdateTask}
        />

        {showSidebar && (
          <TaskSidebar
            task={task}
            activeSessionId={sessionId}
            viewedCwd={viewedCwd}
            subagents={subagents}
            onSwitchSession={actions.selectSession}
            onStartFork={() => state.setSessionModalMode('fork')}
            onStartNewSession={startNewSession}
            startingSession={startingSession}
            onStopSession={actions.stopSession}
            onPromoteSession={actions.promoteSession}
            projects={projects}
            onRequestMove={(id) => state.setMoving(id ?? null)}
            editors={editors}
            primaryEditor={primaryEditor}
            onOpenFolder={actions.openPath}
            onTaskUpdated={(updated) => onApplyTask?.(updated)}
          />
        )}
      </div>

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
        onModeChange={state.setSessionModalMode}
        actions={actions}
        models={models}
        agents={agents}
        projects={projects}
        onUpdateTask={onUpdateTask}
      />
    </section>
  );
};
