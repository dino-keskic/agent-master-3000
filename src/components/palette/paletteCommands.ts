import {
  Archive,
  Bell,
  Bot,
  Columns3,
  DollarSign,
  History,
  LucideIcon,
  MessageSquare,
  PenLine,
  Settings,
  SunMoon
} from 'lucide-react';
import { PaletteCommand } from '../../../shared/palette/search';

/**
 * The board's own commands as the palette lists them: everything the header
 * opens, by name, so none of it needs the mouse.
 *
 * What a command is found by is `shared/palette/search.ts`'s business; this is
 * only the list, its icons, and which handler each id runs.
 */

export interface PaletteHandlers {
  onNewTask: () => void;
  onOpenManager: () => void;
  onOpenSpend: () => void;
  onOpenNotifications: () => void;
  onOpenComments: () => void;
  onOpenColumnEditor: () => void;
  onOpenArchive: () => void;
  onOpenSessionImport: () => void;
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

export interface PaletteAction extends PaletteCommand {
  Icon: LucideIcon;
  run: (handlers: PaletteHandlers) => void;
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'new-task', title: 'Write a new task', keywords: 'create add ticket compose prompt', Icon: PenLine, run: (h) => h.onNewTask() },
  { id: 'manager', title: 'Talk to the manager', keywords: 'chat overview board assistant', Icon: Bot, run: (h) => h.onOpenManager() },
  { id: 'notifications', title: 'Notifications', keywords: 'inbox alerts waiting background', Icon: Bell, run: (h) => h.onOpenNotifications() },
  { id: 'comments', title: 'Review comments', keywords: 'notes feedback', Icon: MessageSquare, run: (h) => h.onOpenComments() },
  { id: 'spend', title: 'Spend', keywords: 'cost money usage tokens week month', Icon: DollarSign, run: (h) => h.onOpenSpend() },
  { id: 'import', title: 'Import OpenCode sessions', keywords: 'history pin existing', Icon: History, run: (h) => h.onOpenSessionImport() },
  { id: 'archive', title: 'Archive', keywords: 'archived restore deleted old', Icon: Archive, run: (h) => h.onOpenArchive() },
  { id: 'columns', title: 'Edit columns', keywords: 'board lanes workflow', Icon: Columns3, run: (h) => h.onOpenColumnEditor() },
  { id: 'settings', title: 'Settings', keywords: 'preferences locations config opencode', Icon: Settings, run: (h) => h.onOpenSettings() },
  { id: 'theme', title: 'Switch between light and dark', keywords: 'theme appearance mode scheme', Icon: SunMoon, run: (h) => h.onToggleTheme() }
];
