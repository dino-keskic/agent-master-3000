import React from 'react';
import { Tooltip } from '@mantine/core';
import { Check, ExternalLink, Trash2, X } from 'lucide-react';
import { BoardTask, PermissionAnswer } from '../../../shared/types';
import { eventHeadline } from '../../../shared/notifications/notifications';
import { BoardNotification, isLiveAwaiting, livePendingRequest } from '../../../shared/notifications/inbox';
import { pickAutoApproveOption, pickRejectOption } from '../../../shared/agent/permissions';
import { relativeTime } from '../../../shared/format';
import { Button, Chip, ChipTone, Surface, SurfaceVariant } from '../ui';

const EVENT_BADGE: Record<BoardNotification['event'], { tone: ChipTone; label: string }> = {
  awaiting_input: { tone: 'wait', label: 'Needs you' },
  turn_complete: { tone: 'run', label: 'Finished' },
  error: { tone: 'err', label: 'Failed' }
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

  const variant: SurfaceVariant = live
    ? 'waiting'
    : item.event === 'error'
      ? 'error'
      : 'default';

  return (
    <Surface
      level="s1"
      variant={variant}
      radius="lg"
      interactive
      className={`p-3 flex flex-col gap-2 ${item.read && !live ? 'opacity-70' : ''}`}
      onClick={onOpen}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {!item.read && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
          <Chip className="font-mono shrink-0">{item.taskId}</Chip>
          <span className="text-[13px] font-semibold text-ink truncate">{item.taskTitle}</span>
        </div>
        <Chip tone={badge.tone} className="shrink-0">
          {badge.label}
        </Chip>
      </div>

      <p className={`m-0 text-[12.5px] leading-snug ${live ? 'text-wait-fg font-medium' : 'text-ink-2'}`}>
        {item.detail || eventHeadline(item.event)}
      </p>

      <div className="flex items-center justify-between gap-2 pt-0.5 flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] text-ink-3 font-mono min-w-0">
          {item.projectName && <span className="truncate">{item.projectName}</span>}
          {task && <span>· {columnTitle(task.columnId)}</span>}
          <span>· {relativeTime(item.createdAt)}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
          {permission && allowOption && (
            <Button
              size="xs"
              variant="wait"
              leftSection={<Check className="w-3 h-3" />}
              onClick={() => onRespond({ kind: 'permission', requestId: permission.requestId, optionId: allowOption })}
            >
              Allow
            </Button>
          )}
          {permission && rejectOption && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<X className="w-3 h-3" />}
              onClick={() => onRespond({ kind: 'permission', requestId: permission.requestId, optionId: rejectOption })}
            >
              Reject
            </Button>
          )}
          {request?.type === 'question' && (
            <Button
              size="xs"
              variant="secondary"
              leftSection={<X className="w-3 h-3" />}
              onClick={() => onRespond({ kind: 'question', requestId: request.requestId, action: 'decline' })}
            >
              Decline
            </Button>
          )}
          <Button
            size="xs"
            variant="secondary"
            leftSection={<ExternalLink className="w-3 h-3" />}
            onClick={onOpen}
          >
            Open
          </Button>
          <Tooltip label="Dismiss" withArrow>
            <button
              type="button"
              className="icon-btn w-6 h-6"
              aria-label="Dismiss"
              onClick={onDismiss}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </Surface>
  );
};
