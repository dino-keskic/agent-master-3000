import React, { useMemo, useState } from 'react';
import { Drawer } from '@mantine/core';
import { Bell, Terminal } from 'lucide-react';
import { BoardColumn, BoardTask, PermissionAnswer } from '../../../shared/types';
import { BoardNotification, unreadCount } from '../../../shared/notifications/inbox';
import { listBackgroundTasks } from '../../../shared/agent/backgroundTasks';
import { Chip, PaneToolbar, SegmentedControl } from '../ui';
import { BackgroundPane } from './BackgroundPane';
import { InboxPane } from './InboxPane';

type PanelTab = 'inbox' | 'background';

interface NotificationPanelProps {
  opened: boolean;
  onClose: () => void;
  tasks: BoardTask[];
  columns: BoardColumn[];
  inbox: BoardNotification[];
  /** Why desktop alerts are not arriving, when they are not. */
  alertsHint?: string;
  onOpenAlertSettings: () => void;
  onOpenSession: (taskId: string, sessionId?: string) => void;
  onRespond: (taskId: string, answer: PermissionAnswer) => void | Promise<void>;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss: (id: string) => void;
  onClear: () => void;
}

const DRAWER_STYLES = {
  content: { backgroundColor: 'var(--glass-pane)', color: 'rgb(var(--c-ink))' },
  header: { backgroundColor: 'rgb(var(--c-surface))', borderBottom: '1px solid rgb(var(--c-line))' },
  body: { padding: 0, height: 'calc(100vh - 60px)', display: 'flex', flexDirection: 'column' }
} as const;

/**
 * Replaces the old sessions list. The inbox is what happened while you looked
 * away; background is what is still running. Clicking a row opens that session.
 *
 * The two rows are in `notifications/`; what is here is the drawer, the tabs,
 * and what each click means. The alert settings are in Settings.
 */
export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  opened,
  onClose,
  tasks,
  columns,
  inbox,
  alertsHint,
  onOpenAlertSettings,
  onOpenSession,
  onRespond,
  onMarkRead,
  onMarkAllRead,
  onDismiss,
  onClear
}) => {
  const [tab, setTab] = useState<PanelTab>('inbox');

  const unread = unreadCount(inbox);
  const background = useMemo(() => listBackgroundTasks(tasks), [tasks]);

  const columnTitle = (columnId: string) => columns.find((c) => c.id === columnId)?.title || columnId;

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
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-accent" />
          <span className="text-[14px] font-semibold text-ink">Notifications</span>
          {unread > 0 && <Chip tone="accent">{unread} new</Chip>}
          {background.length > 0 && <Chip tone="run">{background.length} running</Chip>}
        </div>
      }
      styles={DRAWER_STYLES}
    >
      <PaneToolbar
        left={
          <SegmentedControl<PanelTab>
            size="xs"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'inbox', label: 'Inbox', icon: <Bell className="w-3 h-3" />, count: inbox.length },
              {
                value: 'background',
                label: 'Background',
                icon: <Terminal className="w-3 h-3" />,
                count: background.length
              }
            ]}
          />
        }
      />

      {tab === 'inbox' ? (
        <InboxPane
          inbox={inbox}
          tasks={tasks}
          unread={unread}
          alertsHint={alertsHint}
          columnTitle={columnTitle}
          onOpenAlertSettings={onOpenAlertSettings}
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
