import React, { useState } from 'react';
import { Button, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Bell, BellOff } from 'lucide-react';
import { BoardTask, NotificationSettings, PermissionAnswer } from '../../../shared/types';
import { BoardNotification } from '../../../shared/notifications/inbox';
import { describeDelivery, NotificationDelivery } from '../../../shared/notifications/delivery';
import { AlertSettings, DesktopPermission } from './AlertSettings';
import { Empty } from './Empty';
import { InboxRow } from './InboxRow';

/** What happened while you were looking away, and the alert settings behind it. */

interface InboxPaneProps {
  inbox: BoardNotification[];
  tasks: BoardTask[];
  unread: number;
  settings: NotificationSettings;
  permission: DesktopPermission;
  columnTitle: (columnId: string) => string;
  onPatchSettings: (partial: Partial<NotificationSettings>) => void;
  onEnableDesktop: () => Promise<NotificationDelivery>;
  onTestDesktop: () => Promise<NotificationDelivery>;
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
  settings,
  permission,
  columnTitle,
  onPatchSettings,
  onEnableDesktop,
  onTestDesktop,
  onMarkAllRead,
  onClear,
  onOpen,
  onRespond,
  onDismiss
}) => {
  // Open on arrival when there is something to fix — no permission, or alerts
  // switched off — because that is the only reason the panel would be quiet.
  const [showSettings, setShowSettings] = useState(() => permission !== 'granted' || !settings.enabled);
  // Whatever the last attempt did. The panel is the only place that can tell
  // the difference between "the browser refused" and "the OS ate the banner",
  // and without it both read as a button that does nothing.
  const [delivery, setDelivery] = useState<NotificationDelivery | null>(null);
  const report = (run: () => Promise<NotificationDelivery>) => {
    // Above the settings, not under them. Opening the checkbox stack used to
    // push the only line of feedback below the fold, so the click looked dead.
    setShowSettings(true);
    const finish = (delivery: NotificationDelivery) => {
      setDelivery(delivery);
      const described = describeDelivery(delivery);
      notifications.show({
        title: described.tone === 'ok' ? 'Test notification sent' : 'Notification not shown',
        message: described.text,
        color: described.tone === 'ok' ? 'accent' : 'orange',
        autoClose: 8000
      });
    };
    void run().then(finish, (err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      finish({ ok: false, reason: 'failed', detail });
    });
  };

  return (
    <>
      <Group justify="space-between" px="sm" py={8} className="shrink-0 border-b border-line/50">
        <Group gap={4}>
          <Button
            size="compact-xs"
            variant="subtle"
            color="gray"
            leftSection={settings.enabled ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
            onClick={() => setShowSettings((prev) => !prev)}
          >
            Desktop alerts
          </Button>
          {settings.enabled && permission === 'granted' && (
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => report(onTestDesktop)}>
              Send a test
            </Button>
          )}
        </Group>
        <Group gap={4}>
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

      {delivery && (
        <Text
          size="sm"
          px="sm"
          py={8}
          c={describeDelivery(delivery).tone === 'ok' ? undefined : 'orange.4'}
          className="shrink-0 border-b border-line/50"
        >
          {describeDelivery(delivery).text}
        </Text>
      )}

      {showSettings && (
        <AlertSettings
          settings={settings}
          permission={permission}
          onPatch={onPatchSettings}
          onEnableDesktop={() => report(onEnableDesktop)}
        />
      )}

      <ScrollArea className="flex-1" type="auto">
        <Stack gap={8} p="sm">
          {inbox.length === 0 ? (
            <Empty>Nothing to catch up on</Empty>
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
};
