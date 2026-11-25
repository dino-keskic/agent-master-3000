import React from 'react';
import { ScrollArea } from '@mantine/core';
import { Terminal } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { BackgroundTaskItem } from '../../../shared/agent/backgroundTasks';
import { EmptyState } from '../ui';
import { BackgroundRow } from './BackgroundRow';

/** What is still running somewhere while you are looking at something else. */

interface BackgroundPaneProps {
  items: BackgroundTaskItem[];
  tasks: BoardTask[];
  onOpen: (taskId: string, sessionId?: string) => void;
}

export const BackgroundPane: React.FC<BackgroundPaneProps> = ({ items, tasks, onOpen }) => (
  <ScrollArea className="flex-1" type="auto">
    <div className="flex flex-col gap-2.5 p-3.5">
      {items.length === 0 ? (
        <EmptyState
          icon={<Terminal className="w-4 h-4" />}
          title="No background tasks running"
          description="Active tool calls and background commands across your tasks appear here while they run."
        />
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
    </div>
  </ScrollArea>
);
