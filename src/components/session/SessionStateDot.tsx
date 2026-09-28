import React from 'react';
import { Tooltip } from '@mantine/core';
import { TaskRunState } from '../../../shared/types';

const STATE_COPY: Record<TaskRunState, { label: string; className: string; pulse: boolean; ring?: string }> = {
  running: { label: 'Running', className: 'bg-run', pulse: true },
  awaiting_input: { label: 'Waiting for you', className: 'bg-wait', pulse: true, ring: 'is-wait' },
  error: { label: 'Errored', className: 'bg-err', pulse: false, ring: 'is-err' },
  idle: { label: 'Idle', className: 'bg-ink-4', pulse: false }
};

/**
 * One session's state, as a dot. Sessions of a task run concurrently, so a
 * single badge on the card can't say which of them is busy — this can.
 */
export const SessionStateDot: React.FC<{ state: TaskRunState; label?: string }> = ({ state, label }) => {
  const copy = STATE_COPY[state];
  return (
    <Tooltip label={label || copy.label} withArrow>
      <span className="relative flex h-2 w-2 shrink-0" aria-label={copy.label}>
        {copy.pulse && (
          <span className={`pulse-ring ${copy.ring || ''}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${copy.className}`} />
      </span>
    </Tooltip>
  );
};
