import React from 'react';
import { Tooltip } from '@mantine/core';
import { BellOff, Bot, Plus, Search } from 'lucide-react';
import { TaskRunState } from '../../../shared/types';
import { BoardLoadPhase, connectionLabel } from '../../../shared/board/load';
import { ProjectFilterChip } from '../../../shared/board/projectFilter';
import { attentionLabel } from '../../../shared/attention/attention';
import { formatUsd } from '../../../shared/sessions/cost';
import { Severity } from '../../../shared/setup/report';
import { LogoMark } from '../brand/LogoMark';
import { BoardMenu } from './BoardMenu';
import { ViewMenu, ViewToggle } from './ViewMenu';
import './topbar.css';

/**
 * The top bar: one row, built around one field.
 *
 * The field is the way into everything — finding a task, running a command,
 * or writing a new one — so it sits in the middle and takes the width. Left of
 * it is what the board is showing; right of it is what wants you, the manager,
 * what the week has cost, and a menu for the rest. The composer that used to
 * live here is a sheet now (`NewTaskSheet`), which gave the columns back the
 * height of three rows.
 */

interface HeaderProps {
  /** Where the board is between a first connect and a live feed. */
  connection: BoardLoadPhase;

  chips: ProjectFilterChip[];
  taskCount: number;
  onToggleProject: (id: string) => void;
  onClearProjects: () => void;
  updatedToday: ViewToggle;
  changedFiles: ViewToggle;
  onToggleUpdatedToday: () => void;
  onToggleChangedFiles: () => void;

  /** Raises the command palette — the same thing ⌘K does. */
  onOpenPalette: () => void;
  /** Opens the sheet a new task is written in. */
  onNewTask: () => void;

  /** How many things are waiting on the operator: the strip's length. */
  attentionCount: number;
  /** Set when desktop alerts are switched on but cannot reach this browser. */
  desktopAlertWarning?: string;
  unreadNotificationCount: number;
  onOpenNotifications: () => void;

  /** What the manager is doing; absent until it has been started. */
  managerState?: TaskRunState;
  onOpenManager: () => void;

  /** This week's board-wide spend, once it has been read. */
  weekSpend?: number;
  spendReady?: boolean;
  onOpenSpend: () => void;

  openCommentsCount: number;
  setupSeverity: Severity;
  onOpenComments: () => void;
  onOpenColumnEditor: () => void;
  onOpenArchive: () => void;
  onOpenSessionImport: () => void;
  onOpenSettings: () => void;
}

function managerTooltip(state: TaskRunState | undefined): string {
  if (!state) return 'Start a manager: one conversation that keeps track of every task for you';
  if (state === 'awaiting_input') return 'The manager is waiting for you';
  if (state === 'error') return 'The manager hit an error';
  if (state === 'running') return 'The manager is looking at the board';
  return 'Talk to the manager about the board';
}

export const Header: React.FC<HeaderProps> = (props) => {
  const { connection, managerState, attentionCount, desktopAlertWarning } = props;
  const live = connection === 'ready';
  const managerAlert = managerState === 'awaiting_input' || managerState === 'error';

  return (
    <header className="glass-chrome topbar sticky top-3 z-40 mx-3 mt-3 rounded-[20px]">
      <div className="topbar-side">
        <Tooltip label={`Agent Master 3000 · ${connectionLabel(connection)}`} withArrow>
          <span className="relative inline-flex shrink-0" aria-label={connectionLabel(connection)}>
            <LogoMark size={26} />
            <span className={`topbar-dot ${live ? 'bg-ok' : 'bg-err'}`} aria-hidden />
          </span>
        </Tooltip>
        <ViewMenu
          chips={props.chips}
          total={props.taskCount}
          onToggle={props.onToggleProject}
          onClear={props.onClearProjects}
          updatedToday={props.updatedToday}
          changedFiles={props.changedFiles}
          onToggleUpdatedToday={props.onToggleUpdatedToday}
          onToggleChangedFiles={props.onToggleChangedFiles}
        />
      </div>

      <div className="topbar-field">
        <button type="button" className="omnibox" onClick={props.onOpenPalette} aria-label="Search the board, run a command, or describe a new task">
          <Search className="w-4 h-4 shrink-0" />
          <span className="truncate">Search, run a command, or describe a new task</span>
          <span className="kbd ml-auto">⌘K</span>
        </button>
        <Tooltip label="Write a new task with a project, worktree and attachments (N)" withArrow>
          <button type="button" className="omnibox-new" onClick={props.onNewTask} aria-label="New task">
            <Plus className="w-4 h-4" />
          </button>
        </Tooltip>
      </div>

      <div className="topbar-side justify-end">
        {(attentionCount > 0 || desktopAlertWarning) && (
          <Tooltip label={desktopAlertWarning || 'Waiting on you — listed above the columns'} withArrow>
            <button type="button" className="hdr-btn is-alert" onClick={props.onOpenNotifications}>
              {desktopAlertWarning && <BellOff className="w-3.5 h-3.5" />}
              {attentionLabel(attentionCount) || 'Alerts off'}
            </button>
          </Tooltip>
        )}
        <Tooltip label={managerTooltip(managerState)} withArrow>
          <button type="button" className={`hdr-btn${managerAlert ? ' is-alert' : ''}`} onClick={props.onOpenManager}>
            <Bot className="w-3.5 h-3.5" />
            <span className="topbar-wide">Manager</span>
            {managerState === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-run animate-pulse" aria-label="working" />}
          </button>
        </Tooltip>
        <Tooltip label="What the board has cost this week — open the spend report" withArrow>
          <button type="button" className="hdr-btn" onClick={props.onOpenSpend}>
            {props.spendReady ? formatUsd(props.weekSpend) || '$0.00' : 'Spend'}
          </button>
        </Tooltip>
        <BoardMenu
          openCommentsCount={props.openCommentsCount}
          unreadNotificationCount={props.unreadNotificationCount}
          setupSeverity={props.setupSeverity}
          onOpenNotifications={props.onOpenNotifications}
          onOpenComments={props.onOpenComments}
          onOpenColumnEditor={props.onOpenColumnEditor}
          onOpenArchive={props.onOpenArchive}
          onOpenSessionImport={props.onOpenSessionImport}
          onOpenSettings={props.onOpenSettings}
        />
      </div>
    </header>
  );
};
