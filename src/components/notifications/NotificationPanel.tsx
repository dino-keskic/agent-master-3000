import React, { useMemo, useState } from 'react';
import { Badge, Drawer, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { BoardColumn, BoardTask, GlobalSettings, NotificationSettings, PermissionAnswer } from '../../../shared/types';
import { resolveNotificationSettings } from '../../../shared/notifications/settings';
import { BoardNotification, unreadCount } from '../../../shared/notifications/inbox';
import { listBackgroundTasks } from '../../../shared/agent/backgroundTasks';
import { DesktopPermission, NotificationDelivery } from '../../../shared/notifications/delivery';
import { BackgroundPane } from './BackgroundPane';
import { InboxPane } from './InboxPane';

type PanelTab = 'inbox' | 'background';

interface NotificationPanelProps {
  opened: boolean;
  onClose: () => void;
  tasks: BoardTask[];
  columns: BoardColumn[];
  inbox: BoardNotification[];
  /** This browser's answer, kept live by the notifications hook. */
  permission: DesktopPermission;
  settings: GlobalSettings;
  onUpdateSettings: (patch: Partial<GlobalSettings>) => void | Promise<void>;
  onOpenSession: (taskId: string, sessionId?: string) => void;
  onRespond: (taskId: string, answer: PermissionAnswer) => void | Promise<void>;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClear: () => void;
  onEnableDesktop: () => Promise<NotificationDelivery>;
  onTestDesktop: () => Promise<NotificationDelivery>;
}

const DRAWER_STYLES = {
  content: { backgroundColor: 'rgb(var(--c-canvas))', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface-3))', borderBottom: '1px solid rgb(var(--c-line) / 0.7)' },
  body: { padding: 0, height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' }
} as const;

/**
 * Replaces the old sessions list. The inbox is what happened while you looked
 * away; background is what is still running. Clicking a row opens that session.
 *
 * The two rows and the alert settings are in `notifications/`; what is here is
 * the drawer, the tabs, and what each click means.
 */
export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  opened,
  onClose,
  tasks,
  columns,
  inbox,
  permission,
  settings,
  onUpdateSettings,
  onOpenSession,
  onRespond,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClear,
  onEnableDesktop,
  onTestDesktop
}) => {
  const [tab, setTab] = useState<PanelTab>('inbox');
  const notificationSettings = resolveNotificationSettings(settings.notifications);

  const unread = unreadCount(inbox);
  const background = useMemo(() => listBackgroundTasks(tasks), [tasks]);

  const columnTitle = (columnId: string) => columns.find((c) => c.id === columnId)?.title || columnId;

  const patchNotifications = (partial: Partial<NotificationSettings>) => {
    void onUpdateSettings({ notifications: { ...notificationSettings, ...partial } });
  };

  /** Acting on a row is having read it, whichever control was clicked. */
  const openItem = (item: BoardNotification) => {
    onMarkRead(item.id);
    onOpenSession(item.taskId, item.sessionId);
  };

  const answer = (item: BoardNotification, response: PermissionAnswer) => {
    onMarkRead(item.id);
    void onRespond(item.taskId, response);
  };

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="lg"
      title={
        <Group gap="xs" wrap="nowrap">
          <Text fw={600} size="sm" className="text-ink">
            Notifications
          </Text>
          {unread > 0 && (
            <Badge size="xs" color="accent" variant="filled" className="font-mono">
              {unread} new
            </Badge>
          )}
          {background.length > 0 && (
            <Badge size="xs" color="teal" variant="light" className="font-mono">
              {background.length} running
            </Badge>
          )}
        </Group>
      }
      styles={DRAWER_STYLES}
    >
      <Stack gap="xs" p="sm" className="shrink-0 border-b border-line/70">
        <SegmentedControl
          size="xs"
          value={tab}
          onChange={(value) => setTab(value as PanelTab)}
          data={[
            { value: 'inbox', label: `Inbox (${inbox.length})` },
            {
              value: 'background',
              label: background.length > 0 ? `Background (${background.length})` : 'Background'
            }
          ]}
        />
      </Stack>

      {tab === 'inbox' ? (
        <InboxPane
          inbox={inbox}
          tasks={tasks}
          unread={unread}
          settings={notificationSettings}
          permission={permission}
          columnTitle={columnTitle}
          onPatchSettings={patchNotifications}
          onEnableDesktop={onEnableDesktop}
          onTestDesktop={onTestDesktop}
          onMarkAllRead={onMarkAllRead}
          onClear={onClear}
          onOpen={openItem}
          onRespond={answer}
          onDismiss={onDismiss}
        />
      ) : (
        <BackgroundPane items={background} tasks={tasks} onOpen={onOpenSession} />
      )}
    </Drawer>
  );
};
