import React, { useState } from 'react';
import { Paper, Stack, Tooltip } from '@mantine/core';
import { GitFork, Play, Shrink, X } from 'lucide-react';
import { OpenCodeAgent, OpenCodeModel } from '../../../shared/sessions/types';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { ViewedSession, shortSessionLabel } from '../../../shared/task/viewedSession';
import { changelogSlashCommands } from '../../../shared/review/addressComments';
import { runButtonLabel } from '../../../shared/format';
import { DEFAULT_PERMISSION_MODE } from '../../../shared/agent/permissions';
import { queuedForSession } from '../../../shared/turns/queue';
import { sessionRunSettings, settingsTargetFor } from '../../../shared/task/sessions';
import { ForkAnchor } from '../../../shared/transcript/forkPoint';
import { Composer } from '../composer/Composer';
import { Button } from '../ui';
import { QueuedTurns } from './QueuedTurns';
import { DrawerActions } from './drawerActions';

/**
 * Everything below the transcript: an optional fork-point banner, queued
 * turns, and the compact composer with Compact & Continue tucked cleanly into
 * its own action row.
 */

interface DrawerFooterProps {
  task: BoardTask;
  /** The manager: no column to move it to and nothing to run. */
  conversationOnly?: boolean;
  sessionId?: string;
  /** Prompts sent from here that the server has not put in the queue yet. */
  queuingPrompts: PendingPrompt[];
  view: ViewedSession;
  viewedCwd: string;
  columns: BoardColumn[];
  models: OpenCodeModel[];
  agents: OpenCodeAgent[];
  folderGone: boolean;
  isCompacting: boolean;
  promptText: string;
  onPromptChange: (text: string) => void;
  /** Non-null while the user is branching from a specific turn in the transcript. */
  forkAnchor: ForkAnchor | null;
  onCancelFork: () => void;
  actions: DrawerActions;
  onRunTask: (taskId: string) => void | Promise<void>;
  onUpdateTask: (taskId: string, updates: Partial<BoardTask>) => void | Promise<void>;
}

/** Why the Compact button is unavailable, or what it does when it is. */
function compactHint(isSubagentView: boolean, hasSession: boolean, busy: boolean): string {
  if (isSubagentView) return 'Subagent transcripts cannot be compacted';
  if (!hasSession) return 'This task has not started a session yet';
  if (busy) return "Wait for this session's turn to finish";
  return 'Summarize the conversation so far to free up context';
}

export const DrawerFooter: React.FC<DrawerFooterProps> = ({
  task,
  conversationOnly = false,
  sessionId,
  queuingPrompts,
  view,
  viewedCwd,
  columns,
  models,
  agents,
  folderGone,
  isCompacting,
  promptText,
  onPromptChange,
  forkAnchor,
  onCancelFork,
  actions,
  onRunTask,
  onUpdateTask
}) => {
  const [forking, setForking] = useState(false);

  // The composer shows what the session on screen will run as, not what the
  // task would run — a fork asked on another model keeps it, and changing it
  // here changes that fork rather than everything the task has open.
  const runAs = sessionRunSettings(task, view.viewed?.chosen);
  const change = (settings: { model?: string; agent?: string; thinkingLevel?: string }) => {
    if (settingsTargetFor(task, sessionId) === 'task') void onUpdateTask(task.id, settings);
    else actions.setSessionSettings(settings);
  };

  const hasSession = !!sessionId;
  const runLabel = runButtonLabel(columns.find((c) => c.id === task.columnId), task);
  const hasDraft = promptText.trim().length > 0;

  const submitFork = async (prompt?: string, images?: Parameters<DrawerActions['forkFromPoint']>[2]) => {
    if (!forkAnchor || forking) return;
    setForking(true);
    try {
      await actions.forkFromPoint(forkAnchor, prompt, images);
    } finally {
      setForking(false);
    }
  };

  const extraActions = !conversationOnly && !view.isSubagentView ? (
    <>
      {!forkAnchor && (
        <Tooltip label={compactHint(view.isSubagentView, hasSession, view.busy)} withArrow>
          <Button
            size="xs"
            variant="ghost"
            disabled={!hasSession || view.busy}
            loading={isCompacting}
            aria-label="Compact conversation"
            leftSection={<Shrink className="w-3 h-3" />}
            onClick={actions.compact}
          >
            <span className="hidden sm:inline">Compact</span>
          </Button>
        </Tooltip>
      )}
      {!forkAnchor && !view.busy && !hasDraft && (
        <Tooltip
          label={folderGone ? 'Folder is gone — this worktree was deleted' : undefined}
          disabled={!folderGone}
          withArrow
        >
          <Button
            size="xs"
            variant="ghost"
            disabled={folderGone}
            leftSection={<Play className="w-3 h-3 fill-current" />}
            onClick={() => void onRunTask(task.id)}
          >
            {runLabel}
          </Button>
        </Tooltip>
      )}
    </>
  ) : undefined;

  return (
    <Paper radius={0} className="px-2.5 sm:px-3 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] bg-[var(--session-rail)] border-t border-line shrink-0 overflow-visible relative">
      <Stack gap={6}>
        <QueuedTurns
          turns={queuedForSession(task, sessionId)}
          sending={queuingPrompts}
          onRemove={actions.removeQueued}
          onSendNow={actions.sendQueuedNow}
        />

        {forkAnchor && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-acc-bd bg-acc-bg text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[11px] font-semibold bg-accent text-white shrink-0">
                <GitFork className="w-3 h-3" />
                Fork
              </span>
              <span className="truncate text-ink">
                {forkAnchor.mode === 'before' ? 'Before' : 'After'} {forkAnchor.label} · &ldquo;{forkAnchor.preview}&rdquo;
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Tooltip label="Create this branch up to this point without sending a prompt yet" withArrow>
                <Button
                  size="xs"
                  variant="secondary"
                  loading={forking}
                  onClick={() => void submitFork()}
                >
                  Fork empty
                </Button>
              </Tooltip>
              <button
                type="button"
                aria-label="Cancel fork"
                className="icon-btn w-6 h-6"
                onClick={onCancelFork}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        {view.isSubagentView && (
          <p className="m-0 text-[12px] leading-[1.45] text-ink-3">
            Subagent transcripts are read-only. Go back to the parent session to send a follow-up.
          </p>
        )}

        <Composer
          value={promptText}
          onChange={onPromptChange}
          onSubmit={(prompt, images) =>
            forkAnchor ? submitFork(prompt, images) : actions.sendPrompt(prompt, images)
          }
          cwd={viewedCwd}
          placeholder={
            forkAnchor
              ? forkAnchor.mode === 'before'
                ? 'Edit the prompt to branch from here…'
                : `Send a new direction from ${forkAnchor.label}…`
              : view.isSubagentView
                ? 'Subagent transcripts are read-only'
                : view.isSideSession
                  ? `Follow-up in ${shortSessionLabel(view.viewed?.title)}…`
                  : conversationOnly
                    ? 'Ask about the board…'
                    : 'Reply, or give the next instruction…'
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
          submitting={forking}
          disabled={folderGone || view.isSubagentView}
          submitKind="send"
          submitTooltip={
            forkAnchor
              ? `Fork from ${forkAnchor.label} & send (⌘Enter)`
              : view.isSubagentView
                ? 'Subagent transcripts are read-only'
                : view.isSideSession
                  ? 'Send to this session (⌘Enter)'
                  : 'Send (⌘Enter)'
          }
          slashCommands={changelogSlashCommands(task.changelogComments)}
          extraActions={extraActions}
          onStop={!forkAnchor && view.busy && !view.isSubagentView ? actions.stop : undefined}
        />
      </Stack>
    </Paper>
  );
};
