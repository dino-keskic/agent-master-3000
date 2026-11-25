import React, { useMemo, useState } from 'react';
import { Group, Stack, Tooltip } from '@mantine/core';
import { ChevronDown, ChevronRight, GitFork, Plus } from 'lucide-react';
import { SubagentSession } from '../../../shared/sessions/types';
import { BoardTask } from '../../../shared/types';
import { TaskSessionView, isSessionBusy } from '../../../shared/task/sessions';
import { groupTaskSessions } from '../../../shared/task/sessionSidebar';
import { findSubagent } from '../../../shared/sessions/subagents';
import { SectionLabel } from './SectionLabel';
import { SessionCard } from './SessionCard';
import { Button } from '../ui/Button';
import './sidebar.css';

/**
 * Every session on the task, arranged so the multi-session structure reads at
 * a glance: live threads (with forks nested under their parent) on top, and
 * earlier archived runs folded underneath until asked for.
 */

export const SessionList: React.FC<{
  task: BoardTask;
  sessions: TaskSessionView[];
  viewedSessionId?: string;
  subagents?: Record<string, SubagentSession[]>;
  onSwitchSession?: (sessionId: string) => void;
  onStartFork?: (sourceSessionId?: string) => void;
  onStartNewSession?: () => void;
  /** True while a new session is on its way. */
  startingSession?: boolean;
  onStopSession?: (sessionId: string) => void;
  onPromoteSession?: (sessionId: string) => void;
  /** Open the move dialog for one session. Absent while there is nowhere to send it. */
  onRequestMove?: (sessionId: string) => void;
}> = ({
  task,
  sessions,
  viewedSessionId,
  subagents,
  onSwitchSession,
  onStartFork,
  onStartNewSession,
  startingSession,
  onStopSession,
  onPromoteSession,
  onRequestMove
}) => {
  const busyCount = sessions.filter((session) => isSessionBusy(session.runState)).length;
  const canFork = sessions.length > 0;
  const [earlierOpen, setEarlierOpen] = useState(false);

  const grouped = useMemo(() => groupTaskSessions(sessions), [sessions]);

  // If the user opened an archived session (or one of its subagents), keep the
  // Earlier section open so the active row stays visible.
  const viewingArchived = grouped.archived.some(
    (s) =>
      s.sessionId === viewedSessionId ||
      (!!viewedSessionId && !!findSubagent(subagents?.[s.sessionId] || [], viewedSessionId))
  );
  const showEarlier = earlierOpen || viewingArchived;

  return (
    <Stack gap={6}>
      <Group justify="space-between" align="center" wrap="nowrap" className="px-1">
        <Group gap={6} wrap="nowrap">
          <SectionLabel>Sessions</SectionLabel>
          {sessions.length > 0 && (
            <span className="bubble is-muted h-[16px] min-w-[16px] text-[10.5px]">{sessions.length}</span>
          )}
          {busyCount > 0 && <span className="bubble is-running h-[16px] min-w-[16px]">{busyCount}</span>}
        </Group>

        <Group gap={3} wrap="nowrap">
          {canFork && onStartFork && (
            <Tooltip label="Fork current session from its end" withArrow>
              <button
                type="button"
                className="icon-btn w-6 h-6"
                aria-label="Fork current session"
                onClick={() => onStartFork(viewedSessionId)}
              >
                <GitFork className="w-3 h-3" />
              </button>
            </Tooltip>
          )}
          <Tooltip label="Start a fresh session on this task" withArrow>
            <Button
              size="xs"
              variant="secondary"
              loading={startingSession}
              onClick={onStartNewSession}
              leftSection={<Plus className="w-3 h-3" />}
            >
              New
            </Button>
          </Tooltip>
        </Group>
      </Group>

      {sessions.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-line px-3 py-3 text-center type-meta text-ink-3">
          No sessions yet. Send a message to start one.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {grouped.live.map(({ session, isBranch }) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              isBranch={isBranch}
              task={task}
              viewedSessionId={viewedSessionId}
              subagents={subagents?.[session.sessionId] || []}
              onSwitchSession={onSwitchSession}
              onStartFork={onStartFork}
              onStopSession={onStopSession}
              onPromoteSession={onPromoteSession}
              onRequestMove={onRequestMove}
            />
          ))}

          {grouped.archived.length > 0 && (
            <div className={grouped.live.length > 0 ? 'mt-1.5 pt-1.5 border-t border-line' : ''}>
              <button
                type="button"
                className="session-earlier-toggle"
                aria-expanded={showEarlier}
                onClick={() => setEarlierOpen((open) => !open)}
              >
                <span className="flex items-center gap-1">
                  {showEarlier ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>Earlier runs</span>
                </span>
                <span className="font-mono font-normal tabular-nums">{grouped.archived.length}</span>
              </button>

              {showEarlier && (
                <div className="flex flex-col gap-0.5 mt-0.5">
                  {grouped.archived.map((session) => (
                    <SessionCard
                      key={session.sessionId}
                      session={session}
                      task={task}
                      viewedSessionId={viewedSessionId}
                      subagents={subagents?.[session.sessionId] || []}
                      onSwitchSession={onSwitchSession}
                      onStartFork={onStartFork}
                      onStopSession={onStopSession}
                      onPromoteSession={onPromoteSession}
                      onRequestMove={onRequestMove}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Stack>
  );
};
