import React from 'react';
import { Checkbox } from '@mantine/core';
import { BoardColumn } from '../../../shared/types';

/** What the board does on its own when a task is dropped into this column. */

interface ColumnBehaviorProps {
  column: BoardColumn;
  onPatch: (updates: Partial<BoardColumn>) => void;
}

export const ColumnBehavior: React.FC<ColumnBehaviorProps> = ({ column, onPatch }) => (
  <>
    <Checkbox
      size="xs"
      checked={column.autoRun}
      disabled={!column.prompt.trim()}
      onChange={(e) => onPatch({ autoRun: e.currentTarget.checked })}
      label="Run this prompt when an idle task is dropped here"
      description="A turn that is already running is not interrupted or queued — hit Run after it finishes if you want this prompt."
      classNames={{ label: 'composer-check-label', body: 'composer-check' }}
    />

    <Checkbox
      size="xs"
      checked={Boolean(column.compactOnEnter)}
      onChange={(e) => onPatch({ compactOnEnter: e.currentTarget.checked })}
      label="Compact the session first when an idle task is dropped here"
      description="Summarizes the conversation so far, so the prompt above runs against a smaller context. Skipped while a turn is running."
      classNames={{ label: 'composer-check-label', body: 'composer-check' }}
    />

    <Checkbox
      size="xs"
      checked={Boolean(column.newSessionOnEnter)}
      onChange={(e) => onPatch({ newSessionOnEnter: e.currentTarget.checked })}
      label="Start a fresh session when an idle task enters this stage"
      description="Archives the previous conversation into task session history and starts a clean session for this stage. A running session is left alone."
      classNames={{ label: 'composer-check-label', body: 'composer-check' }}
    />
  </>
);
