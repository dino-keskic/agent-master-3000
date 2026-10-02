import React from 'react';
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Hourglass, SkipForward, X } from 'lucide-react';
import { QueuedTurn } from '../../../shared/types';

interface QueuedTurnsProps {
  turns: QueuedTurn[];
  onRemove: (queuedId: string) => void;
  /** Send it now, cutting off the turn it is waiting on. */
  onSendNow: (queuedId: string) => void;
}

/**
 * Prompts typed while the session was busy. This sits directly above the
 * composer, because it is the answer to "where did what I just typed go?".
 * Each one can be taken back, or sent now — ahead of the rest, cutting off the
 * turn it was waiting on — when it cannot wait for that turn to finish.
 */
export const QueuedTurns: React.FC<QueuedTurnsProps> = ({ turns, onRemove, onSendNow }) => {
  if (turns.length === 0) return null;
  return (
    <Stack gap={4}>
      <Group gap={6} wrap="nowrap">
        <Hourglass className="w-3 h-3 text-acc-fg shrink-0" />
        <Text size="xs" className="font-mono uppercase text-acc-fg">
          {turns.length} queued
        </Text>
        <Text size="xs" c="dimmed" className="truncate">
          sent in order as this session frees up
        </Text>
      </Group>
      {turns.map((turn, index) => (
        <Group key={turn.id} gap={8} wrap="nowrap" className="rounded-md border border-line bg-s4 px-2 py-1">
          <Text size="xs" className="font-mono text-[11px] text-ink-3 shrink-0">
            {index + 1}
          </Text>
          <Text size="xs" className="flex-1 min-w-0 truncate text-ink-2">
            {turn.prompt || 'This column’s prompt'}
          </Text>
          <Tooltip label="Send now — interrupts the running turn" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="xs"
              aria-label={`Send queued prompt ${index + 1} now`}
              onClick={() => onSendNow(turn.id)}
            >
              <SkipForward className="w-3 h-3" />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Remove from the queue" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="xs"
              aria-label={`Remove queued prompt ${index + 1}`}
              onClick={() => onRemove(turn.id)}
            >
              <X className="w-3 h-3" />
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}
    </Stack>
  );
};
