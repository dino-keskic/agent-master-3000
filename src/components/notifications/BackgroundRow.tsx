import React from 'react';
import { Badge, Group, Paper, Text } from '@mantine/core';
import { Terminal } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { BackgroundTaskItem, isExecuteTool, toolCallSummary } from '../../../shared/agent/backgroundTasks';
import { listTaskSessions, sessionRunState } from '../../../shared/task/sessions';
import { relativeTime } from '../../../shared/format';
import { SessionStateDot } from '../session/SessionStateDot';

/**
 * One tool call still running. `execute` gets its own colour because a shell
 * command is the one people watch for.
 */
export const BackgroundRow: React.FC<{
  item: BackgroundTaskItem;
  task?: BoardTask;
  onOpen: () => void;
}> = ({ item, task, onOpen }) => {
  const summary = toolCallSummary(item.toolCall);
  const execute = isExecuteTool(item.toolCall);
  const session = task && item.sessionId
    ? listTaskSessions(task).find((link) => link.sessionId === item.sessionId)
    : undefined;
  const state = task && session ? sessionRunState(task, session) : 'running';

  return (
    <Paper
      p="xs"
      radius="md"
      className={`bg-surface border cursor-pointer flex flex-col gap-2 ${
        execute ? 'border-teal-500/40 hover:border-teal-500/80' : 'border-line/80 hover:border-line-strong'
      }`}
      onClick={onOpen}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          <SessionStateDot state={state} />
          {execute ? (
            <Terminal className="w-3.5 h-3.5 text-teal-300 shrink-0" />
          ) : null}
          <Badge size="xs" color="gray" variant="dot" className="font-mono shrink-0">
            {item.taskId}
          </Badge>
          <Text size="xs" fw={600} className="text-ink truncate">
            {item.toolCall.name}
          </Text>
        </Group>
        <Badge size="xs" color="teal" variant="light" className="font-mono shrink-0">
          {item.toolCall.status === 'pending' ? 'Pending' : 'Running'}
        </Badge>
      </Group>
      {summary && (
        <Text size="11px" className="font-mono text-ink-2 truncate">
          {summary}
        </Text>
      )}
      <Group gap={6} wrap="wrap" className="text-[10px] text-ink-3 font-mono">
        <span className="truncate max-w-[180px]">{item.taskTitle}</span>
        {item.sessionTitle && item.sessionTitle !== item.taskTitle && <span>· {item.sessionTitle}</span>}
        {item.projectName && <span>· {item.projectName}</span>}
        <span>· started {relativeTime(item.startedAt)}</span>
      </Group>
    </Paper>
  );
};
