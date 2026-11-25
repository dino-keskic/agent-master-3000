import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask, PermissionAnswer, TaskLogItem } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { parseImageLimitError } from '../../../shared/sessions/imageLimit';
import { settingsTargetFor } from '../../../shared/task/sessions';
import { ViewedSession } from '../../../shared/task/viewedSession';
import { ForkMode, buildForkAnchor } from '../../../shared/transcript/forkPoint';
import { PendingRequestCard } from '../request/PendingRequestCard';
import { Banner, Button } from '../ui';
import { AgentPlanBanner } from './AgentPlanBanner';
import { DrawerTabs } from './DrawerTabs';
import { DrawerFooter } from './DrawerFooter';
import { DrawerActions } from './drawerActions';
import { DrawerState } from './useDrawerState';
import { EditorOption } from '../../api';

/**
 * The reading column of the drawer, top to bottom: what went wrong, what the
 * session shows, what it is asking for, and the box you answer in.
 *
 * The sidebar beside it is about the task; this column is about the one
 * conversation on screen.
 */

interface DrawerMainPaneProps {
  task: BoardTask;
  /** The manager: a conversation only — no column, no Changes or Tools. */
  conversationOnly?: boolean;
  sessionId?: string;
  view: ViewedSession;
  sidebarOpen?: boolean;
  /** The transcript on screen (`drawerTranscript`). */
  logs: TaskLogItem[];
  /** Prompts sent from here that the transcript does not show yet. */
  pendingPrompts: PendingPrompt[];
  /** Prompts sent from here on their way into the queue. */
  queuingPrompts: PendingPrompt[];
  awaitingTranscript: boolean;
  viewedCwd: string;
  folderGone: boolean;
  state: DrawerState;
  actions: DrawerActions;
  primaryEditor?: EditorOption;
  changedFiles: number;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  onApplyTask?: (task: BoardTask) => void;
  onRespond: (taskId: string, answer: PermissionAnswer) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
}

export const DrawerMainPane: React.FC<DrawerMainPaneProps> = ({
  task,
  conversationOnly = false,
  sessionId,
  view,
  sidebarOpen = true,
  logs,
  pendingPrompts,
  queuingPrompts,
  awaitingTranscript,
  viewedCwd,
  folderGone,
  state,
  actions,
  primaryEditor,
  changedFiles,
  columns,
  models,
  agents,
  onApplyTask,
  onRespond,
  onRunTask,
  onUpdateTask
}) => {
  const handleForkLog = (log: TaskLogItem, mode: ForkMode) => {
    const anchor = buildForkAnchor(log, logs, mode);
    if (!anchor) return;
    state.setForkAnchor(anchor);
    if (mode === 'before' && anchor.originalText) {
      state.setPromptText(anchor.originalText);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {task.error && (
        <Banner
          strip
          tone="err"
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
          actions={
            !conversationOnly && !view.busy && parseImageLimitError(task.error) ? (
              <Button size="xs" variant="secondary" onClick={() => void onRunTask(task.id)}>
                Retry & trim images
              </Button>
            ) : undefined
          }
        >
          <span className="block break-words whitespace-pre-wrap">{task.error}</span>
        </Banner>
      )}

      <DrawerTabs
        task={task}
        conversationOnly={conversationOnly}
        sessionId={sessionId}
        view={view}
        sidebarOpen={sidebarOpen}
        logs={logs}
        pendingPrompts={pendingPrompts}
        awaitingTranscript={awaitingTranscript}
        viewedCwd={viewedCwd}
        tab={state.tab}
        onTabChange={state.setTab}
        actions={actions}
        primaryEditor={primaryEditor}
        changedFiles={changedFiles}
        models={models}
        forkAnchorLogId={state.forkAnchor?.logId}
        onForkLog={handleForkLog}
        onUseAgent={(agentId) => {
          if (settingsTargetFor(task, sessionId) === 'task') void onUpdateTask(task.id, { agent: agentId });
          else actions.setSessionSettings({ agent: agentId });
        }}
        onInsertSkill={(name) => {
          const prefix = `/${name} `;
          const next = state.promptText.trimStart().startsWith(prefix) ? state.promptText : `${prefix}${state.promptText}`;
          state.setPromptText(next);
          state.setTab('session');
        }}
        onApplyTask={onApplyTask}
      />

      {task.pendingRequest && (
        <div className="px-3 pb-2">
          <PendingRequestCard
            request={task.pendingRequest}
            busy={state.isResponding}
            onAnswer={(answer) => {
              state.setIsResponding(true);
              void Promise.resolve(onRespond(task.id, answer)).finally(() => state.setIsResponding(false));
            }}
          />
        </div>
      )}

      <AgentPlanBanner
        task={task}
        logs={logs}
        running={view.busy || task.runState === 'running'}
      />

      {(conversationOnly || state.tab === 'session' || state.tab === 'changes') && (
        <DrawerFooter
          task={task}
          conversationOnly={conversationOnly}
          sessionId={sessionId}
          queuingPrompts={queuingPrompts}
          view={view}
          viewedCwd={viewedCwd}
          columns={columns}
          models={models}
          agents={agents}
          folderGone={folderGone}
          isCompacting={state.isCompacting}
          promptText={state.promptText}
          onPromptChange={state.setPromptText}
          forkAnchor={state.forkAnchor}
          onCancelFork={() => state.setForkAnchor(null)}
          actions={actions}
          onRunTask={onRunTask}
          onUpdateTask={onUpdateTask}
        />
      )}
    </div>
  );
};
