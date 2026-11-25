import React, { useState } from 'react';
import { Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, GitFork } from 'lucide-react';
import { SubagentSession } from '../../../shared/sessions/types';
import { BoardTask } from '../../../shared/types';
import { TaskSessionView, isSessionBusy } from '../../../shared/task/sessions';
import {
  sessionDisplayTitle,
  sessionRoleLabel,
  shouldAutoExpandSubagents,
  subagentSummary
} from '../../../shared/task/sessionSidebar';
import { findSubagent } from '../../../shared/sessions/subagents';
import { formatCompactCount, formatContext, formatUsd } from '../../../shared/sessions/cost';
import { formatDuration, liveLastTurnDurationMs, liveSessionDurationMs } from '../../../shared/sessions/duration';
import { relativeTime, shortModelLabel } from '../../../shared/format';
import { useNow } from '../ui/useNow';
import { SessionStateDot } from '../session/SessionStateDot';
import { SessionCardHeader } from './SessionCardHeader';
import { SubagentTree } from './SubagentTree';

/**
 * One session row on the task, styled to match the left WorkRail, plus a single
 * collapsible summary row for any subagents it spawned.
 */

interface SessionCardProps {
  session: TaskSessionView;
  /** True when nested beneath its live parent session as a fork branch. */
  isBranch?: boolean;
  /** The task, for the folder, project and title this session is compared against. */
  task: BoardTask;
  /** The session the drawer is showing, which may be a subagent under this one. */
  viewedSessionId?: string;
  /** Subagent sessions spawned from this one. */
  subagents: SubagentSession[];
  onSwitchSession?: (sessionId: string) => void;
  onStartFork?: (sourceSessionId?: string) => void;
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

function roleToneClass(session: TaskSessionView): string {
  if (session.runState === 'awaiting_input') return 'text-wait-fg font-semibold';
  if (session.runState === 'running') return 'text-run-fg font-semibold';
  if (session.runState === 'error') return 'text-err-fg font-semibold';
  if (session.isPrimary) return 'text-acc-fg font-semibold';
  return 'text-ink-4';
}

export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  isBranch = false,
  task,
  viewedSessionId,
  subagents,
  onSwitchSession,
  onStartFork,
  onStopSession,
  onPromoteSession,
  onRequestMove
}) => {
  const [subagentsExpanded, setSubagentsExpanded] = useState(false);
  const now = useNow(session.runState === 'running');

  const costText = formatUsd(session.cost);
  const compactCtx = formatCompactCount(session.contextTokens);
  const fullCtx = formatContext(session.contextTokens, session.contextLimit);
  const durationText = formatDuration(liveSessionDurationMs(session, now));
  const lastTurnText = formatDuration(liveLastTurnDurationMs(session, now));
  const shortModel = session.model ? shortModelLabel(session.model) : undefined;
  const childOpen = !session.isActive && !!viewedSessionId && !!findSubagent(subagents, viewedSessionId);
  const otherFolder = elsewhere(session, task);

  const title = sessionDisplayTitle(session, task.title);
  const role = sessionRoleLabel(session);
  const timeText = relativeTime(session.updatedAt || session.createdAt).replace(/ ago$/, '');
  const timingSummary =
    lastTurnText && durationText && lastTurnText !== durationText
      ? `${lastTurnText} / ${durationText}`
      : durationText || lastTurnText;
  const stats = [costText, compactCtx, timingSummary, otherFolder].filter(Boolean).join(' · ');

  const tooltip = [
    session.title && session.title !== title ? session.title : undefined,
    shortModel,
    fullCtx ? `Context ${fullCtx}` : undefined,
    lastTurnText
      ? session.runState === 'running'
        ? `This turn ${lastTurnText}`
        : `Last prompt ${lastTurnText}`
      : undefined,
    durationText ? `Whole session ${durationText}` : undefined
  ]
    .filter(Boolean)
    .join(' · ');

  const subSummary = subagents.length > 0 ? subagentSummary(subagents) : undefined;
  const showSubagents =
    subagents.length > 0 && (subagentsExpanded || shouldAutoExpandSubagents(subagents, viewedSessionId));

  const showForkIcon = isBranch && !isSessionBusy(session.runState) && session.runState !== 'error';

  return (
    <div className={isBranch ? 'session-branch flex flex-col gap-0.5' : 'flex flex-col gap-0.5'}>
      <Tooltip label={tooltip} disabled={!tooltip} withArrow position="left" openDelay={350}>
        <div
          role="button"
          tabIndex={0}
          aria-current={session.isActive ? 'true' : undefined}
          onClick={() => onSwitchSession?.(session.sessionId)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSwitchSession?.(session.sessionId);
            }
          }}
          className={`session-row focus:outline-none focus-visible:ring-1 focus-visible:ring-accent${
            session.isActive ? ' is-active' : childOpen ? ' is-child-open' : ''
          }${session.archivedAt ? ' is-archived' : ''}`}
        >
          <span className="shrink-0 mt-[5px]">
            {showForkIcon ? (
              <GitFork className="w-3 h-3 text-ink-3" />
            ) : (
              <SessionStateDot state={session.runState} />
            )}
          </span>

          <span className="min-w-0 flex-1">
            <span className="session-row-meta">
              <span className={`truncate ${roleToneClass(session)}`}>{role}</span>
              {timeText && <span className="tabular-nums shrink-0">{timeText}</span>}
            </span>
            <span className="session-row-title">{title}</span>
            {stats && <span className="session-row-stats">{stats}</span>}
          </span>

          <SessionCardHeader
            session={session}
            onForkSession={onStartFork && (() => onStartFork(session.sessionId))}
            onStopSession={onStopSession}
            onPromoteSession={onPromoteSession}
            onRequestMove={onRequestMove && (() => onRequestMove(session.sessionId))}
          />
        </div>
      </Tooltip>

      {subSummary && (
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            aria-expanded={showSubagents}
            onClick={(e) => {
              e.stopPropagation();
              setSubagentsExpanded((open) => !open);
            }}
            className="w-full pl-5 pr-2 py-1 rounded-md hover:bg-s3h flex items-center justify-between gap-2 text-[11.5px] text-ink-3 hover:text-ink-2 transition-colors"
          >
            <span className="flex items-center gap-1 min-w-0">
              {showSubagents ? (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 shrink-0" />
              )}
              {subSummary.running > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse motion-reduce:animate-none shrink-0" />
              )}
              <span className="truncate">
                {subSummary.running > 0
                  ? `${subSummary.running} running · ${subSummary.count} subagent${subSummary.count === 1 ? '' : 's'}`
                  : `${subSummary.count} subagent${subSummary.count === 1 ? '' : 's'}`}
              </span>
            </span>
            {subSummary.totalCost > 0 && (
              <span className="text-[11px] text-ink-4 shrink-0 tabular-nums">
                {formatUsd(subSummary.totalCost)}
              </span>
            )}
          </button>

          {showSubagents && (
            <SubagentTree nodes={subagents} activeSessionId={viewedSessionId} onOpen={onSwitchSession} />
          )}
        </div>
      )}
    </div>
  );
};
