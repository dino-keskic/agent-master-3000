import React from 'react';
import { Tooltip } from '@mantine/core';
import { Hourglass, SkipForward, X } from 'lucide-react';
import { QueuedTurn } from '../../../shared/types';
import { PendingPrompt } from '../../../shared/turns/pendingPrompts';
import { Chip, Surface } from '../ui';

interface QueuedTurnsProps {
  turns: QueuedTurn[];
  /** Sent from here while the session was busy, before the server has queued them. */
  sending: PendingPrompt[];
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
export const QueuedTurns: React.FC<QueuedTurnsProps> = ({ turns, sending, onRemove, onSendNow }) => {
  const count = turns.length + sending.length;
  if (count === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Chip tone="accent" className="font-mono">
          <Hourglass className="w-2.5 h-2.5" />
          {count} queued
        </Chip>
        <span className="text-[11.5px] text-ink-3 truncate">
          sent in order as this session frees up
        </span>
      </div>
      {turns.map((turn, index) => (
        <Surface
          key={turn.id}
          level="s4"
          border="default"
          radius="sm"
          className="flex items-center gap-2 px-2.5 py-1.5"
        >
          <span className="font-mono text-[11.5px] text-ink-3 shrink-0">{index + 1}.</span>
          <span className="text-[12px] flex-1 min-w-0 truncate text-ink-2">
            {turn.prompt || 'This column’s prompt'}
          </span>
          <Tooltip label="Send now — interrupts the running turn" withArrow>
            <button
              type="button"
              className="icon-btn w-6 h-6"
              aria-label={`Send queued prompt ${index + 1} now`}
              onClick={() => onSendNow(turn.id)}
            >
              <SkipForward className="w-3 h-3" />
            </button>
          </Tooltip>
          <Tooltip label="Remove from the queue" withArrow>
            <button
              type="button"
              className="icon-btn w-6 h-6"
              aria-label={`Remove queued prompt ${index + 1}`}
              onClick={() => onRemove(turn.id)}
            >
              <X className="w-3 h-3" />
            </button>
          </Tooltip>
        </Surface>
      ))}
      {sending.map((prompt, index) => (
        <div
          key={`sending-${prompt.id}`}
          className="flex items-center gap-2 rounded-md border border-dashed border-line px-2.5 py-1.5 opacity-70"
        >
          <span className="font-mono text-[11.5px] text-ink-3 shrink-0">
            {turns.length + index + 1}.
          </span>
          <span className="text-[12px] flex-1 min-w-0 truncate text-ink-2">
            {prompt.text || (prompt.images?.length ? 'Image' : '')}
          </span>
          <span className="text-[11px] font-mono text-ink-3 shrink-0">queuing…</span>
        </div>
      ))}
    </div>
  );
};
