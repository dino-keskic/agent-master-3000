import React from 'react';
import { Group, Text } from '@mantine/core';
import { AlertTriangle } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask, PermissionAnswer, TaskLogItem } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { ViewedSession } from '../../../shared/task/viewedSession';
import { PendingRequestCard } from '../request/PendingRequestCard';
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
  sessionId?: string;
  view: ViewedSession;
  /** The transcript on screen (`drawerTranscript`). */
  logs: TaskLogItem[];
  /** Prompts sent from here that the transcript does not show yet. */
  pendingPrompts: PendingPrompt[];
  awaitingTranscript: boolean;
  viewedCwd: string;
  folderGone: boolean;
  state: DrawerState;
  actions: DrawerActions;
  primaryEditor?: EditorOption;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  onApplyTask?: (task: BoardTask) => void;
  onRespond: (taskId: string, answer: PermissionAnswer) => void | Promise<void>;
  onMoveTask: (taskId: string, columnId: string) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
}

export const DrawerMainPane: React.FC<DrawerMainPaneProps> = ({
  task,
  sessionId,
  view,
  logs,
  pendingPrompts,
  awaitingTranscript,
  viewedCwd,
  folderGone,
  state,
  actions,
  primaryEditor,
  columns,
  models,
  agents,
  onApplyTask,
  onRespond,
  onMoveTask,
  onRunTask,
  onUpdateTask
}) => (
  <div className="flex-1 flex flex-col min-h-0 min-w-0">
    {task.error && (
      <Group gap={6} px="sm" py={6} className="bg-err-bg border-b border-err-bd text-err-fg" wrap="nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <Text size="xs" className="truncate">{task.error}</Text>
      </Group>
    )}

    <DrawerTabs
      task={task}
      sessionId={sessionId}
      view={view}
      logs={logs}
      pendingPrompts={pendingPrompts}
      awaitingTranscript={awaitingTranscript}
      viewedCwd={viewedCwd}
      tab={state.tab}
      onTabChange={state.setTab}
      actions={actions}
      primaryEditor={primaryEditor}
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
      onStop={actions.stop}
    />

    <DrawerFooter
      task={task}
      sessionId={sessionId}
      view={view}
      viewedCwd={viewedCwd}
      columns={columns}
      models={models}
      agents={agents}
      folderGone={folderGone}
      isCompacting={state.isCompacting}
      promptText={state.promptText}
      onPromptChange={state.setPromptText}
      actions={actions}
      onMoveTask={onMoveTask}
      onRunTask={onRunTask}
      onUpdateTask={onUpdateTask}
    />
  </div>
);
