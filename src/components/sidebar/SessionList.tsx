import React from 'react';
import { Group, Stack, Tooltip } from '@mantine/core';
import { GitFork, Plus } from 'lucide-react';
import { SubagentSession } from '../../../shared/sessions/types';
import { BoardTask } from '../../../shared/types';
import { TaskSessionView, isSessionBusy } from '../../../shared/task/sessions';
import { SectionLabel } from './SectionLabel';
import { SessionCard } from './SessionCard';
import { Button } from '../ui/Button';

/**
 * Every session on the task, and the two ways to start another one.
 *
 * A new session starts on the click, where the main one runs; a fork opens the
 * dialog, because a fork is a question and needs one written.
 */

export const SessionList: React.FC<{
  task: BoardTask;
  sessions: TaskSessionView[];
  viewedSessionId?: string;
  subagents?: Record<string, SubagentSession[]>;
  onSwitchSession?: (sessionId: string) => void;
  onStartFork?: () => void;
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

  return (
    <Stack gap={8}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <SectionLabel>Sessions ({sessions.length})</SectionLabel>
          {busyCount > 0 && <span className="bubble is-running h-[17px] min-w-[17px]">{busyCount} active</span>}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Tooltip
            label={canFork ? 'Copy a session and ask it something on the side' : 'Run this task once before forking it'}
            withArrow
          >
            <Button size="xs" disabled={!canFork} onClick={onStartFork} leftSection={<GitFork className="w-3 h-3" />}>
              Fork
            </Button>
          </Tooltip>
          <Tooltip label="Start a blank session and continue the work there" withArrow>
            <Button
              size="xs"
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
          No sessions yet. Run the task to start one.
        </p>
      ) : (
        <Stack gap={6}>
          {sessions.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              task={task}
              viewedSessionId={viewedSessionId}
              subagents={subagents?.[session.sessionId] || []}
              onSwitchSession={onSwitchSession}
              onStopSession={onStopSession}
              onPromoteSession={onPromoteSession}
              onRequestMove={onRequestMove}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};
