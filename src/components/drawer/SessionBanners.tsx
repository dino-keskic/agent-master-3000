import React from 'react';
import { Group } from '@mantine/core';
import { CornerDownLeft, GitFork, History, Users } from 'lucide-react';
import { ViewedSession } from '../../../shared/task/viewedSession';
import { subagentLabel } from '../../../shared/sessions/subagents';
import { SessionStateDot } from '../session/SessionStateDot';
import { Button, Chip, Type } from '../ui';

interface SessionBannersProps {
  view: ViewedSession;
  /** The task's own session, for the way back out of a fork. */
  primarySessionId?: string;
  onSelectSession: (sessionId: string) => void;
}

/**
 * The strip above the transcript that says what you are reading when it is not
 * the task's own session — a subagent's history, or a fork — and how to get
 * back. When you *are* in the main session, it says whether anything else on
 * this task is still working, since that transcript is elsewhere.
 */
export const SessionBanners: React.FC<SessionBannersProps> = ({ view, primarySessionId, onSelectSession }) => {
  const { caller, isSideSession, isSubagentView, otherBusyCount, runState, subagent, viewed } = view;

  if (isSubagentView) {
    const backId = caller?.sessionId || subagent?.parentId || primarySessionId;
    return (
      <Group justify="space-between" px="sm" py={6} className="bg-acc-bg border-b border-acc-bd" wrap="nowrap">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          <Users className="w-3.5 h-3.5 text-acc-fg shrink-0" />
          <Chip tone="accent" className="shrink-0">Subagent</Chip>
          <Type role="title" size="sm" as="span" tone="accent" className="shrink-0">
            {subagentLabel(subagent)}
          </Type>
          {/* Nobody typed into this session; say whose instruction it is. */}
          {caller && (
            <Type role="label" className="truncate">
              called by <span className="font-semibold text-ink-2">{caller.label}</span>
              {caller.isRoot ? '' : ' subagent'}
            </Type>
          )}
          {subagent?.title && (
            <Type role="label" tone="faint" className="truncate hidden sm:block" title={subagent.title}>
              · {subagent.title}
            </Type>
          )}
        </Group>
        <Button
          size="xs"
          variant="ghost"
          leftSection={<CornerDownLeft className="w-3 h-3" />}
          onClick={() => backId && onSelectSession(backId)}
          disabled={!backId}
        >
          {caller ? `Back to ${caller.label}` : 'Back to current session'}
        </Button>
      </Group>
    );
  }

  if (isSideSession) {
    return (
      <Group justify="space-between" px="sm" py={6} className="bg-acc-bg border-b border-acc-bd" wrap="nowrap">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          <SessionStateDot state={runState} />
          {viewed?.kind === 'btw' ? (
            <GitFork className="w-3.5 h-3.5 text-acc-fg shrink-0" />
          ) : (
            <History className="w-3.5 h-3.5 text-acc-fg shrink-0" />
          )}
          <Type role="title" size="sm" as="span" tone="accent" className="truncate">
            {viewed?.title || 'Side chat'}
          </Type>
          {viewed?.archivedAt && <Chip className="shrink-0">archived</Chip>}
        </Group>
        {/* "Current", not "main": several sessions carry a Main badge, but only
            one is where follow-ups actually land. */}
        <Button
          size="xs"
          variant="ghost"
          leftSection={<CornerDownLeft className="w-3 h-3" />}
          onClick={() => primarySessionId && onSelectSession(primarySessionId)}
          disabled={!primarySessionId}
        >
          Back to current session
        </Button>
      </Group>
    );
  }

  if (otherBusyCount > 0) {
    return (
      <Group px="sm" py={6} gap={6} className="bg-surface-2 border-b border-line" wrap="nowrap">
        <SessionStateDot state="running" />
        <Type role="copy" as="span">
          {otherBusyCount} other session{otherBusyCount === 1 ? '' : 's'} on this task{' '}
          {otherBusyCount === 1 ? 'is' : 'are'} still working
        </Type>
      </Group>
    );
  }

  return null;
};

