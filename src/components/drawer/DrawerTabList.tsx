import React from 'react';
import { Group, Tabs } from '@mantine/core';
import { GitCompare, MessagesSquare, Wrench } from 'lucide-react';

interface DrawerTabListProps {
  /** How many sessions the task has; shown once there is more than one. */
  sessionCount: number;
  /** Names the fork or subagent when the view is not the task's own session. */
  sessionLabel: string;
  changedFiles: number;
  openCommentCount: number;
}

/** The drawer's three tabs, each with the count that makes it worth opening. */
export const DrawerTabList: React.FC<DrawerTabListProps> = ({
  sessionCount,
  sessionLabel,
  changedFiles,
  openCommentCount
}) => (
  <Tabs.List className="px-2.5 shrink-0 border-b border-line">
    <Tabs.Tab
      value="session"
      leftSection={<MessagesSquare className="w-3.5 h-3.5" />}
      rightSection={
        sessionCount > 1 ? <span className="bubble is-muted h-[17px] min-w-[17px]">{sessionCount}</span> : null
      }
    >
      {sessionLabel}
    </Tabs.Tab>
    <Tabs.Tab
      value="changes"
      leftSection={<GitCompare className="w-3.5 h-3.5" />}
      rightSection={
        changedFiles > 0 || openCommentCount > 0 ? (
          <Group gap={4} wrap="nowrap">
            {changedFiles > 0 && <span className="bubble is-muted h-[17px] min-w-[17px]">{changedFiles}</span>}
            {openCommentCount > 0 && <span className="bubble h-[17px] min-w-[17px]">{openCommentCount}</span>}
          </Group>
        ) : null
      }
    >
      Changes
    </Tabs.Tab>
    <Tabs.Tab value="tools" leftSection={<Wrench className="w-3.5 h-3.5" />}>
      Tools
    </Tabs.Tab>
  </Tabs.List>
);
