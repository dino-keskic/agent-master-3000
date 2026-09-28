import React from 'react';
import { ScrollArea, Stack } from '@mantine/core';
import { BoardTask } from '../../../shared/types';
import { BackgroundTaskItem } from '../../../shared/agent/backgroundTasks';
import { BackgroundRow } from './BackgroundRow';
import { Empty } from './Empty';

/** What is still running somewhere while you are looking at something else. */

interface BackgroundPaneProps {
  items: BackgroundTaskItem[];
  tasks: BoardTask[];
  onOpen: (taskId: string, sessionId?: string) => void;
}

export const BackgroundPane: React.FC<BackgroundPaneProps> = ({ items, tasks, onOpen }) => (
  <ScrollArea className="flex-1" type="auto">
    <Stack gap={8} p="sm">
      {items.length === 0 ? (
        <Empty>No background tasks running</Empty>
      ) : (
        items.map((item) => (
          <BackgroundRow
            key={`${item.taskId}:${item.toolCall.toolCallId}`}
            item={item}
            task={tasks.find((candidate) => candidate.id === item.taskId)}
            onOpen={() => onOpen(item.taskId, item.sessionId)}
          />
        ))
      )}
    </Stack>
  </ScrollArea>
);
