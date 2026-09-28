import React from 'react';
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { Archive, Bot, Brain, Cpu, MessageSquare } from 'lucide-react';
import { TaskCardSummary, formatBadgeName } from '../../../shared/task/card';
import { ThinkingLevel } from '../../../shared/types';
import { Chip, Type } from '../ui';
import { SessionStateDot } from '../session/SessionStateDot';

/** The id, what the task is doing, and the way to archive it. */
export const CardHeader: React.FC<{
  taskId: string;
  summary: TaskCardSummary;
  model?: string;
  agent?: string;
  thinkingLevel?: ThinkingLevel;
  onArchive: (taskId: string) => void;
}> = ({ taskId, summary, model, agent, thinkingLevel, onArchive }) => {
  const { running, waiting, hasError, statusLabel, queuedCount, openCommentsCount } = summary;

  return (
    <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
      <Group gap={8} wrap="nowrap" className="min-w-0">
        {(running || waiting) && <SessionStateDot state={waiting ? 'awaiting_input' : 'running'} />}
        {hasError && !running && !waiting && <SessionStateDot state="error" />}
        <Type role="meta" className="shrink-0">{taskId}</Type>
        {model && (
          <Chip title={model} className="shrink-0">
            <Cpu className="w-2.5 h-2.5 text-ink-4 shrink-0" />
            <span className="truncate max-w-[7rem]">{formatBadgeName(model)}</span>
          </Chip>
        )}
        {agent && (
          <Chip title={agent} className="shrink-0">
            <Bot className="w-2.5 h-2.5 text-ink-4 shrink-0" />
            <span className="truncate max-w-[6rem]">{formatBadgeName(agent)}</span>
          </Chip>
        )}
        {thinkingLevel && thinkingLevel !== 'default' && (
          <Chip title={thinkingLevel} className="shrink-0">
            <Brain className="w-2.5 h-2.5 text-ink-4 shrink-0" />
            <span>{formatBadgeName(thinkingLevel)}</span>
          </Chip>
        )}
        {statusLabel && (
          <Type role="meta" tone={waiting ? 'wait' : running ? 'run' : 'err'} className="truncate">
            {statusLabel}
          </Type>
        )}
        {/* The receipt for typing ahead: without it a follow-up sent mid-turn
            looks like it went nowhere. */}
        {queuedCount > 0 && (
          <Tooltip
            label={`${queuedCount} prompt${queuedCount === 1 ? '' : 's'} waiting for the current turn`}
            withArrow
          >
            <Type role="meta" tone="accent" className="shrink-0">{queuedCount} queued</Type>
          </Tooltip>
        )}
        {openCommentsCount > 0 && (
          <Tooltip
            label={`${openCommentsCount} open review note${openCommentsCount === 1 ? '' : 's'}`}
            withArrow
          >
            <Chip tone="accent" className="shrink-0 gap-1">
              <MessageSquare className="w-2.5 h-2.5" />
              {openCommentsCount}
            </Chip>
          </Tooltip>
        )}
      </Group>

      <Tooltip label="Archive task" withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          className="task-card-delete focus-visible:!opacity-100 relative z-[2]"
          aria-label={`Archive ${taskId}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (
              window.confirm(
                `Archive ${taskId}? It leaves the board and keeps everything — restore it from the archive.`
              )
            ) {
              onArchive(taskId);
            }
          }}
        >
          <Archive className="w-3.5 h-3.5" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
};
