import React from 'react';
import { Group, Tooltip } from '@mantine/core';
import { Archive, Bell, BellOff, Columns3, DollarSign, History, MessageSquare, Settings } from 'lucide-react';
import { formatUsd } from '../../../shared/sessions/cost';
import { Severity } from '../../../shared/setup/report';
import { ThemeToggle } from './ThemeToggle';

/**
 * Everything the header opens. The notification button carries three different
 * counts, so its tooltip is ranked the way the board ranks attention: blocked
 * beats unread, and unread beats work merely running. Above all of them is
 * alerts that are switched on but cannot arrive, since that is the one that
 * hides the others.
 */

interface BoardActionsProps {
  /** This week's board-wide spend, once it has been read. */
  weekSpend?: number;
  /** True after the first spend read, including a $0 week. */
  spendReady?: boolean;
  unreadNotificationCount: number;
  awaitingSessionCount: number;
  backgroundTaskCount: number;
  /** Set when desktop alerts are switched on but cannot reach this browser. */
  desktopAlertWarning?: string;
  openCommentsCount?: number;
  onOpenSpend: () => void;
  onOpenNotifications: () => void;
  onOpenComments: () => void;
  onOpenColumnEditor: () => void;
  onOpenSessionImport: () => void;
  /** Opens the archive. Optional only while `App` still has to wire it. */
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  /** How the board's locations look; an error lights the settings button. */
  setupSeverity: Severity;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export const BoardActions: React.FC<BoardActionsProps> = ({
  weekSpend,
  spendReady,
  unreadNotificationCount,
  awaitingSessionCount,
  backgroundTaskCount,
  desktopAlertWarning,
  openCommentsCount,
  onOpenSpend,
  onOpenNotifications,
  onOpenComments,
  onOpenColumnEditor,
  onOpenSessionImport,
  onOpenArchive,
  onOpenSettings,
  setupSeverity
}) => {
  const bellTooltip = desktopAlertWarning
    ? desktopAlertWarning
    : awaitingSessionCount > 0
    ? `${plural(awaitingSessionCount, 'session')} waiting for you`
    : unreadNotificationCount > 0
      ? `${plural(unreadNotificationCount, 'unread notification')}`
      : backgroundTaskCount > 0
        ? `${plural(backgroundTaskCount, 'background task')} running`
        : 'Notifications and background tasks';
  const bellCount = unreadNotificationCount || backgroundTaskCount;

  return (
    <Group gap={4}>
      <Tooltip label="What the board is costing this week and this month" withArrow>
        <button type="button" className="hdr-btn" onClick={onOpenSpend}>
          <DollarSign className="w-3.5 h-3.5" />
          {spendReady ? `${formatUsd(weekSpend) || '$0.00'} this week` : 'Spend'}
        </button>
      </Tooltip>
      <Tooltip label={bellTooltip} withArrow>
        {/* Filled while a session is blocked on the operator, or while the
            alerts you switched on cannot reach you — the two things in the
            header that should pull the eye. */}
        <button
          type="button"
          className={`hdr-btn${awaitingSessionCount > 0 || desktopAlertWarning ? ' is-alert' : ''}`}
          onClick={onOpenNotifications}
        >
          {desktopAlertWarning ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          Notifications
          {bellCount > 0 ? ` · ${bellCount}` : ''}
        </button>
      </Tooltip>
      <Tooltip label="Review notes across tasks" withArrow>
        <button
          type="button"
          className={`hdr-btn${openCommentsCount && openCommentsCount > 0 ? ' is-alert' : ''}`}
          onClick={onOpenComments}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Comments
          {openCommentsCount && openCommentsCount > 0 ? ` · ${openCommentsCount}` : ''}
        </button>
      </Tooltip>
      <Tooltip label="Edit board columns" withArrow>
        <button type="button" className="hdr-btn is-icon" onClick={onOpenColumnEditor} aria-label="Edit board columns">
          <Columns3 className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip label="Archived tasks — restore or delete for good" withArrow>
        <button type="button" className="hdr-btn is-icon" onClick={onOpenArchive} aria-label="Open archive">
          <Archive className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip label="Import OpenCode sessions" withArrow>
        <button type="button" className="hdr-btn is-icon" onClick={onOpenSessionImport} aria-label="Import OpenCode sessions">
          <History className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip label={setupSeverity === 'error' ? 'Something the board needs is missing — open Settings' : 'Settings — where the data and OpenCode are'} withArrow>
        <button
          type="button"
          className={`hdr-btn is-icon${setupSeverity === 'error' ? ' is-alert' : ''}`}
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </Tooltip>
      <ThemeToggle />
    </Group>
  );
};
