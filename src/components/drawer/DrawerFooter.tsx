import React from 'react';
import { Paper, Stack } from '@mantine/core';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { ViewedSession, shortSessionLabel } from '../../../shared/task/viewedSession';
import { changelogSlashCommands } from '../../../shared/review/addressComments';
import { runButtonLabel } from '../../../shared/format';
import { DEFAULT_PERMISSION_MODE } from '../../../shared/agent/permissions';
import { queuedForSession } from '../../../shared/turns/queue';
import { sessionRunSettings, settingsTargetFor } from '../../../shared/task/sessions';
import { Composer } from '../composer/Composer';
import { DrawerFooterControls } from './DrawerFooterControls';
import { QueuedTurns } from './QueuedTurns';
import { DrawerActions } from './drawerActions';

/**
 * Everything below the transcript: what to do with the session, what is waiting
 * to be sent to it, and the box the next turn is written in.
 *
 * The composer's wording follows the session on screen, because "send" means
 * something different in a side session than in the task's own — and nothing at
 * all in a subagent's, which is a recording.
 */

interface DrawerFooterProps {
  task: BoardTask;
  sessionId?: string;
  view: ViewedSession;
  viewedCwd: string;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  folderGone: boolean;
  isCompacting: boolean;
  promptText: string;
  onPromptChange: (text: string) => void;
  actions: DrawerActions;
  onMoveTask: (taskId: string, columnId: string) => void | Promise<void>;
  onRunTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
}

export const DrawerFooter: React.FC<DrawerFooterProps> = ({
  task,
  sessionId,
  view,
  viewedCwd,
  columns,
  models,
  agents,
  folderGone,
  isCompacting,
  promptText,
  onPromptChange,
  actions,
  onMoveTask,
  onRunTask,
  onUpdateTask
}) => {
  // The composer shows what the session on screen will run as, not what the
  // task would run — a fork asked on another model keeps it, and changing it
  // here changes that fork rather than everything the task has open.
  const runAs = sessionRunSettings(task, view.viewed?.chosen);
  const change = (settings: { model?: string; agent?: string; thinkingLevel?: string }) => {
    if (settingsTargetFor(task, sessionId) === 'task') void onUpdateTask(task.id, settings);
    else actions.setSessionSettings(settings);
  };

  return (
  <Paper px={16} py={14} radius={0} className="bg-surface border-t border-line shrink-0 overflow-visible relative">
    <Stack gap="xs">
      <DrawerFooterControls
        columns={columns}
        columnId={task.columnId}
        runState={view.runState}
        busy={view.busy}
        isSubagentView={view.isSubagentView}
        hasSession={!!sessionId}
        otherBusyCount={view.otherBusyCount}
        folderGone={folderGone}
        runLabel={runButtonLabel(columns.find((c) => c.id === task.columnId), task)}
        isCompacting={isCompacting}
        onMoveColumn={(columnId) => void onMoveTask(task.id, columnId)}
        onCompact={actions.compact}
        onStop={actions.stop}
        onRun={() => void onRunTask(task.id)}
      />

      <QueuedTurns
        turns={queuedForSession(task, sessionId)}
        onRemove={actions.removeQueued}
        onSendNow={actions.sendQueuedNow}
      />

      {view.isSubagentView && (
        <p className="m-0 text-[12px] leading-[1.55] text-ink-3">
          Subagent transcripts are read-only. Go back to the parent session to send a follow-up.
        </p>
      )}
      <Composer
        value={promptText}
        onChange={onPromptChange}
        onSubmit={actions.sendPrompt}
        cwd={viewedCwd}
        placeholder={
          view.isSubagentView
            ? 'Subagent transcripts are read-only'
            : view.isSideSession
              ? `Follow-up in ${shortSessionLabel(view.viewed?.title)}…`
              : 'Follow-up to continue this session…'
        }
        models={models}
        agents={agents}
        thinkingLevel={runAs.thinkingLevel || task.thinkingLevel}
        onThinkingLevelChange={(val) => change({ thinkingLevel: val })}
        model={runAs.model || task.model}
        onModelChange={(val) => change({ model: val })}
        permissionMode={task.permissionMode || DEFAULT_PERMISSION_MODE}
        onPermissionModeChange={(val) => void onUpdateTask(task.id, { permissionMode: val })}
        agent={runAs.agent || task.agent}
        onAgentChange={(val) => change({ agent: val })}
        disabled={folderGone || view.isSubagentView}
        submitKind="send"
        submitTooltip={
          view.isSubagentView
            ? 'Subagent transcripts are read-only'
            : view.isSideSession
              ? 'Send to this session (⌘Enter)'
              : 'Send (⌘Enter)'
        }
        slashCommands={changelogSlashCommands(task.changelogComments)}
      />
    </Stack>
  </Paper>
  );
};
