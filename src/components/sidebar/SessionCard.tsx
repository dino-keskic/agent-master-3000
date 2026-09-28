import React from 'react';
import { Group } from '@mantine/core';
import { SubagentSession } from '../../../shared/sessions/types';
import { BoardTask } from '../../../shared/types';
import { TaskSessionView } from '../../../shared/task/sessions';
import { findSubagent, runningSubagentCount } from '../../../shared/sessions/subagents';
import { formatContext, formatUsd } from '../../../shared/sessions/cost';
import { relativeTime, shortModelLabel } from '../../../shared/format';
import { Type } from '../ui';
import { InlineMarkdown } from '../stream/Markdown';
import { SessionCardHeader } from './SessionCardHeader';
import { SubagentTree } from './SubagentTree';

/**
 * One session on the task, and the subagents it spawned.
 *
 * A card is highlighted when it is the one on screen — and dimmed less than the
 * rest when a subagent *under* it is, because otherwise opening a child makes
 * the branch it came from look inactive.
 */

interface SessionCardProps {
  session: TaskSessionView;
  /** The task, for the folder and project this session is compared against. */
  task: BoardTask;
  /** The session the drawer is showing, which may be a subagent under this one. */
  viewedSessionId?: string;
  /** Subagent sessions spawned from this one. */
  subagents: SubagentSession[];
  onSwitchSession?: (sessionId: string) => void;
  onStopSession?: (sessionId: string) => void;
  onPromoteSession?: (sessionId: string) => void;
  /** Open the move dialog for this session. Absent while there is nowhere to send it. */
  onRequestMove?: (sessionId: string) => void;
}

/** Set when this session runs somewhere other than the task's own folder. */
function elsewhere(session: TaskSessionView, task: BoardTask): string | undefined {
  const project = session.projectName && session.projectName !== task.projectName ? session.projectName : undefined;
  const folder =
    session.cwd && session.cwd !== task.cwd ? session.cwd.replace(/\/+$/, '').split('/').pop() : undefined;
  const parts = [project, folder].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  task,
  viewedSessionId,
  subagents,
  onSwitchSession,
  onStopSession,
  onPromoteSession,
  onRequestMove
}) => {
  const costText = formatUsd(session.cost);
  const contextText = formatContext(session.contextTokens, session.contextLimit);
  const shortModel = session.model ? shortModelLabel(session.model) : undefined;
  const childOpen = !session.isActive && !!viewedSessionId && !!findSubagent(subagents, viewedSessionId);
  const otherFolder = elsewhere(session, task);

  return (
    <div className="flex flex-col gap-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSwitchSession?.(session.sessionId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSwitchSession?.(session.sessionId);
          }
        }}
        className={`rounded-[10px] p-2.5 transition-all cursor-pointer flex flex-col gap-1.5 border text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
          session.isActive
            ? 'border-accent shadow-[0_0_0_1px_var(--acc-bd)] bg-surface'
            : childOpen
              ? 'border-line-strong bg-s3'
              : 'border-line hover:border-line-strong bg-s3'
        } ${session.archivedAt ? 'opacity-70' : ''}`}
      >
        <SessionCardHeader
          session={session}
          onStopSession={onStopSession}
          onPromoteSession={onPromoteSession}
          onRequestMove={onRequestMove && (() => onRequestMove(session.sessionId))}
        />

        {session.archivedAt && (
          <Type role="meta">archived · {relativeTime(session.archivedAt)}</Type>
        )}

        {session.lastUserMessage && (
          <Type role="copy" className="line-clamp-1"><InlineMarkdown text={session.lastUserMessage} /></Type>
        )}

        {otherFolder && <Type role="meta" className="truncate">{otherFolder}</Type>}

        <Group justify="space-between" align="center" wrap="nowrap" className="pt-0.5">
          <Type role="meta" className="min-w-0 truncate">
            {[shortModel, costText, contextText].filter(Boolean).join(' · ')}
          </Type>
          <Type role="meta" className="shrink-0">{relativeTime(session.updatedAt || session.createdAt)}</Type>
        </Group>
      </div>

      {subagents.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {/* A long tree is mostly finished work; this says how much of it is
              not, before the user goes looking row by row. */}
          {runningSubagentCount(subagents) > 0 && (
            <Type role="meta" tone="run" className="pl-3">
              {runningSubagentCount(subagents)} running
            </Type>
          )}
          <SubagentTree nodes={subagents} activeSessionId={viewedSessionId} onOpen={onSwitchSession} />
        </div>
      )}
    </div>
  );
};
