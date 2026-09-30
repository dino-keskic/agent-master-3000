import React from 'react';
import { ScrollArea } from '@mantine/core';
import { SubagentSession } from '../../../shared/sessions/types';
import { BoardTask, ProjectFolder } from '../../../shared/types';
import { taskSessionViews } from '../../../shared/task/sessions';
import { contextFillPct, formatContext } from '../../../shared/sessions/cost';
import { sessionSpendTotal } from '../../../shared/spend/taskSpend';
import { EditorOption } from '../../api';
import { TaskLinksSection } from './TaskLinksSection';
import { SessionList } from './SessionList';
import { LocationSection } from './LocationSection';
import { UsageSection } from './UsageSection';
import { useTaskSpend } from './useTaskSpend';

/**
 * The column beside the conversation: the task's sessions, what they have cost,
 * what it is linked to and where it runs. What it changed is the Changes tab's.
 *
 * Each block is its own component; what is left here is the order they come in
 * and the handful of numbers that describe the session on screen rather than
 * the task as a whole. A block with nothing to say renders nothing, and the
 * rule between blocks goes with it.
 */

interface TaskSidebarProps {
  task: BoardTask;
  activeSessionId?: string;
  viewedCwd?: string;
  /** Child OpenCode sessions keyed by the linked session they were spawned from. */
  subagents?: Record<string, SubagentSession[]>;
  onSwitchSession?: (sessionId: string) => void;
  onStartFork?: () => void;
  onStartNewSession?: () => void;
  /** True while a new session is on its way, so the button cannot start two. */
  startingSession?: boolean;
  onStopSession?: (sessionId: string) => void;
  onPromoteSession?: (sessionId: string) => void;
  /** The board's projects, so the task and its sessions can be moved between them. */
  projects: ProjectFolder[];
  /** Open the move dialog: for one session, or for the task when given none. */
  onRequestMove: (sessionId?: string) => void;
  editors: EditorOption[];
  primaryEditor?: EditorOption;
  onOpenFolder: (editorId: string) => void;
  onTaskUpdated: (task: BoardTask) => void;
}

export const TaskSidebar: React.FC<TaskSidebarProps> = ({
  task,
  activeSessionId,
  viewedCwd,
  subagents,
  onSwitchSession,
  onStartFork,
  onStartNewSession,
  startingSession,
  onStopSession,
  onPromoteSession,
  projects,
  onRequestMove,
  editors,
  primaryEditor,
  onOpenFolder,
  onTaskUpdated
}) => {
  // The drawer owns which session is on screen; the store's value is the
  // fallback for a drawer that has not been touched since it opened.
  const viewedSessionId = activeSessionId || task.activeSessionId || task.sessionId;
  const sessions = taskSessionViews(task).map((view) => ({
    ...view,
    isActive: view.sessionId === viewedSessionId
  }));

  // Stats follow the session on screen, and fall back to the task's own totals
  // for a drawer opened on a task that has never run.
  const viewed = sessions.find((session) => session.isActive);
  const contextTokens = viewed?.contextTokens ?? task.contextTokens;
  const contextLimit = viewed?.contextLimit ?? task.contextLimit;

  // The session's cost and the task's total are the same money, so they are
  // the same read. The session's own column total is the fallback
  // for the moment before the breakdown lands, and for a session it has no row
  // for at all.
  const spend = useTaskSpend(task.id, task.runState === 'running');
  const viewedSpend = sessionSpendTotal(spend.breakdown, viewedSessionId);

  return (
    <ScrollArea className="w-80 shrink-0 border-l border-line bg-surface" type="auto">
      <div className="flex flex-col divide-y divide-line [&>*]:px-4 [&>*]:py-4">
        <SessionList
          task={task}
          sessions={sessions}
          viewedSessionId={viewedSessionId}
          subagents={subagents}
          onSwitchSession={onSwitchSession}
          onStartFork={onStartFork}
          onStartNewSession={onStartNewSession}
          startingSession={startingSession}
          onStopSession={onStopSession}
          onPromoteSession={onPromoteSession}
          onRequestMove={projects.length > 0 ? onRequestMove : undefined}
        />

        <UsageSection
          sessionCost={viewedSpend ?? viewed?.cost ?? task.cost}
          multiSession={sessions.length > 1}
          subagentCount={task.subagentCount}
          contextPct={contextFillPct(contextTokens, contextLimit)}
          contextLabel={formatContext(contextTokens, contextLimit)}
          breakdown={spend.breakdown}
          loading={spend.loading}
        />

        <TaskLinksSection task={task} onTaskUpdated={onTaskUpdated} />

        <LocationSection
          task={task}
          viewedCwd={viewedCwd}
          projects={projects}
          onRequestMove={() => onRequestMove()}
          editors={editors}
          primaryEditor={primaryEditor}
          onOpenFolder={onOpenFolder}
        />
      </div>
    </ScrollArea>
  );
};
