import React from 'react';
import { Tabs, Tooltip } from '@mantine/core';
import { Bot, GitCompare, MessageSquare, MessagesSquare, WandSparkles, Wrench } from 'lucide-react';

interface DrawerTabListProps {
  /** How many sessions the task has; shown only when the sidebar is closed so the count is never duplicated. */
  sessionCount: number;
  sidebarOpen?: boolean;
  /** Names the fork or subagent when the view is not the task's own session. */
  sessionLabel: string;
  changedFiles: number;
  openCommentCount: number;
  /** Right-aligned utility slot (e.g. prompt jump menu on the Session tab). */
  rightSlot?: React.ReactNode;
}

/**
 * Compact navigation tab bar: primary work views (Session, Changes) separated
 * by a subtle divider from secondary config tabs (Tools, Agents, Skills), with
 * right-aligned transcript utilities so no second header bar is needed.
 */
export const DrawerTabList: React.FC<DrawerTabListProps> = ({
  sessionCount,
  sidebarOpen = true,
  sessionLabel,
  changedFiles,
  openCommentCount,
  rightSlot
}) => (
  <div className="flex items-center justify-between gap-2 px-2 sm:px-2.5 shrink-0 border-b border-line bg-[var(--session-rail)]">
    <Tabs.List className="border-0 flex-nowrap overflow-x-auto no-scrollbar min-w-0">
      <Tabs.Tab
        value="session"
        className="shrink-0"
        leftSection={<MessagesSquare className="w-3.5 h-3.5" />}
        rightSection={
          !sidebarOpen && sessionCount > 1 ? (
            <span className="bubble is-muted h-[16px] min-w-[16px]">{sessionCount}</span>
          ) : null
        }
      >
        {sessionLabel}
      </Tabs.Tab>
      <Tabs.Tab
        value="changes"
        className="shrink-0"
        leftSection={<GitCompare className="w-3.5 h-3.5" />}
        rightSection={
          changedFiles > 0 || openCommentCount > 0 ? (
            <div className="flex items-center gap-1">
              {changedFiles > 0 && (
                <Tooltip label={`${changedFiles} changed file${changedFiles === 1 ? '' : 's'}`} withArrow>
                  <span className="bubble is-muted h-[16px] min-w-[16px]">{changedFiles}</span>
                </Tooltip>
              )}
              {openCommentCount > 0 && (
                <Tooltip label={`${openCommentCount} open review note${openCommentCount === 1 ? '' : 's'}`} withArrow>
                  <span className="bubble h-[16px] min-w-[16px] gap-0.5">
                    <MessageSquare className="w-2.5 h-2.5" />
                    {openCommentCount}
                  </span>
                </Tooltip>
              )}
            </div>
          ) : null
        }
      >
        Changes
      </Tabs.Tab>

      <span className="self-center h-3.5 w-px bg-line mx-1 shrink-0" aria-hidden />

      <Tabs.Tab value="tools" className="shrink-0" leftSection={<Wrench className="w-3 h-3" />}>
        Tools
      </Tabs.Tab>
      <Tabs.Tab value="agents" className="shrink-0" leftSection={<Bot className="w-3 h-3" />}>
        Agents
      </Tabs.Tab>
      <Tabs.Tab value="skills" className="shrink-0" leftSection={<WandSparkles className="w-3 h-3" />}>
        Skills
      </Tabs.Tab>
    </Tabs.List>

    {rightSlot && <div className="flex items-center gap-1 shrink-0">{rightSlot}</div>}
  </div>
);
