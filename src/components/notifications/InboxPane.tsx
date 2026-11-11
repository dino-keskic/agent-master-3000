import React from 'react';
import { Button, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { BoardTask, PermissionAnswer } from '../../../shared/types';
import { BoardNotification } from '../../../shared/notifications/inbox';
import { Empty } from './Empty';
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
    <Group justify="space-between" px="sm" py={8} className="shrink-0 border-b border-line/50" wrap="nowrap">
      <Group gap={6} wrap="nowrap" className="min-w-0">
        {alertsHint && (
          <Text size="xs" c="orange.4" className="truncate" title={alertsHint}>
            {alertsHint}
          </Text>
        )}
        <Button size="compact-xs" variant="subtle" color="gray" className="shrink-0" onClick={onOpenAlertSettings}>
          Alert settings
        </Button>
      </Group>
      <Group gap={4} wrap="nowrap">
        {unread > 0 && (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={onMarkAllRead}>
            Mark all read
          </Button>
        )}
        {inbox.length > 0 && (
          <Button size="compact-xs" variant="subtle" color="gray" onClick={onClear}>
            Clear
          </Button>
        )}
      </Group>
    </Group>

    <ScrollArea className="flex-1" type="auto">
      <Stack gap={8} p="sm">
        {inbox.length === 0 ? (
          <Empty>Nothing to catch up on. Finished turns and questions from agents land here.</Empty>
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
      </Stack>
    </ScrollArea>
  </>
);
