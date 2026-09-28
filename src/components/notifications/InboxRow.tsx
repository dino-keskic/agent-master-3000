import React from 'react';
import { ActionIcon, Badge, Button, Group, Paper, Text, Tooltip } from '@mantine/core';
import { Check, Trash2, X } from 'lucide-react';
import { BoardTask, PermissionAnswer } from '../../../shared/types';
import { eventHeadline } from '../../../shared/notifications/notifications';
import { BoardNotification, isLiveAwaiting, livePendingRequest } from '../../../shared/notifications/inbox';
import { pickAutoApproveOption, pickRejectOption } from '../../../shared/agent/permissions';
import { relativeTime } from '../../../shared/format';

const EVENT_BORDER: Record<BoardNotification['event'], string> = {
  awaiting_input: 'border-amber-500/50 hover:border-amber-500',
  turn_complete: 'border-teal-500/30 hover:border-teal-500/70',
  error: 'border-rose-500/40 hover:border-rose-500/80'
};

const EVENT_BADGE: Record<BoardNotification['event'], { color: string; label: string }> = {
  awaiting_input: { color: 'yellow', label: 'Needs you' },
  turn_complete: { color: 'teal', label: 'Finished' },
  error: { color: 'red', label: 'Failed' }
};

interface InboxRowProps {
  item: BoardNotification;
  /** Every task: whether this row is still live is a question about the board. */
  tasks: BoardTask[];
  columnTitle: (columnId: string) => string;
  onOpen: () => void;
  onRespond: (answer: PermissionAnswer) => void;
  onDismiss: () => void;
}

/**
 * One thing that happened while you were away.
 *
 * A row whose session is still blocked answers in place: Allow and Reject are
 * the whole point of being told, and making the user open the task first would
 * waste the interruption.
 */
export const InboxRow: React.FC<InboxRowProps> = ({
  item,
  tasks,
  columnTitle,
  onOpen,
  onRespond,
  onDismiss
}) => {
  const live = isLiveAwaiting(item, tasks);
  const request = livePendingRequest(item, tasks);
  const permission = request?.type === 'permission' ? request : undefined;
  const allowOption = permission ? pickAutoApproveOption(permission.options) : undefined;
  const rejectOption = permission ? pickRejectOption(permission.options) : undefined;
  const task = tasks.find((candidate) => candidate.id === item.taskId);
  const badge = EVENT_BADGE[item.event];

  return (
    <Paper
      p="xs"
      radius="md"
      className={`bg-surface border transition-colors cursor-pointer flex flex-col gap-2 ${EVENT_BORDER[item.event]} ${item.read && !live ? 'opacity-70' : ''}`}
      onClick={onOpen}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap={6} wrap="nowrap" className="min-w-0">
          {!item.read && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
          <Badge size="xs" color="gray" variant="dot" className="font-mono shrink-0">
            {item.taskId}
          </Badge>
          <Text size="xs" fw={600} className="text-ink truncate">
            {item.taskTitle}
          </Text>
        </Group>
        <Badge size="xs" color={badge.color} variant={live ? 'filled' : 'light'} className="font-mono shrink-0">
          {badge.label}
        </Badge>
      </Group>

      <Text size="11px" className={live ? 'text-amber-200' : 'text-ink-2'}>
        {item.detail || eventHeadline(item.event)}
      </Text>

      <Group gap={6} wrap="wrap" className="text-[10px] text-ink-3 font-mono">
        {item.projectName && <span>{item.projectName}</span>}
        {task && <span>· {columnTitle(task.columnId)}</span>}
        <span>· {relativeTime(item.createdAt)}</span>
      </Group>

      <Group justify="flex-end" gap={6} onClick={(e) => e.stopPropagation()}>
        {permission && allowOption && (
          <Button
            size="compact-xs"
            color="accent"
            leftSection={<Check className="w-3 h-3" />}
            onClick={() => onRespond({ kind: 'permission', requestId: permission.requestId, optionId: allowOption })}
          >
            Allow
          </Button>
        )}
        {permission && rejectOption && (
          <Button
            size="compact-xs"
            color="gray"
            variant="subtle"
            leftSection={<X className="w-3 h-3" />}
            onClick={() => onRespond({ kind: 'permission', requestId: permission.requestId, optionId: rejectOption })}
          >
            Reject
          </Button>
        )}
        {request?.type === 'question' && (
          <Button
            size="compact-xs"
            color="gray"
            variant="subtle"
            leftSection={<X className="w-3 h-3" />}
            onClick={() => onRespond({ kind: 'question', requestId: request.requestId, action: 'decline' })}
          >
            Decline
          </Button>
        )}
        <Button size="compact-xs" color="accent" variant="light" onClick={onOpen}>
          Open
        </Button>
        <Tooltip label="Dismiss" withArrow>
          <ActionIcon size="sm" color="gray" variant="subtle" aria-label="Dismiss" onClick={onDismiss}>
            <Trash2 className="w-3 h-3" />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
};
