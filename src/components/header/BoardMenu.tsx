import React from 'react';
import { Menu } from '@mantine/core';
import { Archive, Bell, Columns3, History, MessageSquare, MoreHorizontal, Settings } from 'lucide-react';
import { Severity } from '../../../shared/setup/report';
import { ThemeToggle } from './ThemeToggle';

/**
 * The "⋯" at the end of the top bar: everything about the board that is opened
 * a few times a week rather than a few times an hour. Each of these used to be
 * a button of its own, which is how the bar came to be two rows tall. The dot
 * on the trigger is for the two that can be wrong without you looking — a
 * missing location, and review notes nobody has answered.
 */

interface BoardMenuProps {
  openCommentsCount: number;
  unreadNotificationCount: number;
  /** How the board's locations look; an error marks Settings. */
  setupSeverity: Severity;
  onOpenNotifications: () => void;
  onOpenComments: () => void;
  onOpenColumnEditor: () => void;
  onOpenArchive: () => void;
  onOpenSessionImport: () => void;
  onOpenSettings: () => void;
}

const Badge: React.FC<{ value: number }> = ({ value }) =>
  value > 0 ? <span className="filter-chip-count">{value}</span> : null;

export const BoardMenu: React.FC<BoardMenuProps> = ({
  openCommentsCount,
  unreadNotificationCount,
  setupSeverity,
  onOpenNotifications,
  onOpenComments,
  onOpenColumnEditor,
  onOpenArchive,
  onOpenSessionImport,
  onOpenSettings
}) => {
  const broken = setupSeverity === 'error';
  const marked = broken || openCommentsCount > 0;

  return (
    <Menu shadow="md" position="bottom-end" withinPortal width={240}>
      <Menu.Target>
        <button type="button" className="hdr-btn is-icon relative" aria-label="More: columns, archive, import, settings">
          <MoreHorizontal className="w-4 h-4" />
          {marked && <span className={`topbar-dot ${broken ? 'bg-err' : 'bg-wait'}`} aria-hidden />}
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<Bell className="w-3.5 h-3.5" />}
          rightSection={<Badge value={unreadNotificationCount} />}
          onClick={onOpenNotifications}
        >
          Notifications
        </Menu.Item>
        <Menu.Item
          leftSection={<MessageSquare className="w-3.5 h-3.5" />}
          rightSection={<Badge value={openCommentsCount} />}
          onClick={onOpenComments}
        >
          Review comments
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item leftSection={<Columns3 className="w-3.5 h-3.5" />} onClick={onOpenColumnEditor}>
          Edit columns
        </Menu.Item>
        <Menu.Item leftSection={<Archive className="w-3.5 h-3.5" />} onClick={onOpenArchive}>
          Archive
        </Menu.Item>
        <Menu.Item leftSection={<History className="w-3.5 h-3.5" />} onClick={onOpenSessionImport}>
          Import sessions
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          leftSection={<Settings className="w-3.5 h-3.5" />}
          rightSection={broken ? <span className="text-[12px] text-err-fg">needs a look</span> : null}
          onClick={onOpenSettings}
        >
          Settings
        </Menu.Item>
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[13px] text-ink-2">Theme</span>
          <ThemeToggle />
        </div>
      </Menu.Dropdown>
    </Menu>
  );
};
