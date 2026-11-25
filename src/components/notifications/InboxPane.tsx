import React from 'react';
import { ScrollArea } from '@mantine/core';
import { Bell, BellOff, CheckCheck, Settings, Trash2 } from 'lucide-react';
import { BoardTask, PermissionAnswer } from '../../../shared/types';
import { BoardNotification } from '../../../shared/notifications/inbox';
import { Banner, Button, EmptyState } from '../ui';
import { InboxRow } from './InboxRow';

/**
 * What happened while you were looking away. How the board is allowed to
 * interrupt is a preference, and lives in Settings; this only says so when
 * alerts are off, since that is the one reason the list would stay quiet.
 */

interface InboxPaneProps {
  inbox: BoardNotification[];
  tasks: BoardTask[];
  unread: number;
  /** Set when desktop alerts are off or not allowed: the reason, in a line. */
  alertsHint?: string;
  columnTitle: (columnId: string) => string;
  onOpenAlertSettings: () => void;
  onMarkAllRead: () => void;
  onClear: () => void;
  onOpen: (item: BoardNotification) => void;
  onRespond: (item: BoardNotification, response: PermissionAnswer) => void;
  onDismiss: (id: string) => void;
}

export const InboxPane: React.FC<InboxPaneProps> = ({
  inbox,
  tasks,
  unread,
  alertsHint,
  columnTitle,
  onOpenAlertSettings,
  onMarkAllRead,
  onClear,
  onOpen,
  onRespond,
  onDismiss
}) => (
  <>
    {alertsHint && (
      <Banner
        strip
        tone="wait"
        icon={<BellOff className="w-3.5 h-3.5" />}
        actions={
          <Button size="xs" variant="secondary" onClick={onOpenAlertSettings}>
            Alert settings
          </Button>
        }
      >
        {alertsHint}
      </Banner>
    )}

    <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-line bg-surface/30 shrink-0">
      <Button
        size="xs"
        variant="ghost"
        leftSection={<Settings className="w-3 h-3" />}
        onClick={onOpenAlertSettings}
      >
        Alert settings
      </Button>
      <div className="flex items-center gap-1.5">
        {unread > 0 && (
          <Button
            size="xs"
            variant="ghost"
            leftSection={<CheckCheck className="w-3 h-3" />}
            onClick={onMarkAllRead}
          >
            Mark all read
          </Button>
        )}
        {inbox.length > 0 && (
          <Button
            size="xs"
            variant="ghost"
            leftSection={<Trash2 className="w-3 h-3" />}
            onClick={onClear}
          >
            Clear
          </Button>
        )}
      </div>
    </div>

    <ScrollArea className="flex-1" type="auto">
      <div className="flex flex-col gap-2.5 p-3.5">
        {inbox.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-4 h-4" />}
            title="All caught up"
            description="Nothing to catch up on. Finished turns and questions from agents land here."
          />
        ) : (
          inbox.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              tasks={tasks}
              columnTitle={columnTitle}
              onOpen={() => onOpen(item)}
              onRespond={(response) => onRespond(item, response)}
              onDismiss={() => onDismiss(item.id)}
            />
          ))
        )}
      </div>
    </ScrollArea>
  </>
);
