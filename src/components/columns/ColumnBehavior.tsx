import React from 'react';
import { Zap } from 'lucide-react';
import { BoardColumn } from '../../../shared/types';
import { Surface, ToggleRow } from '../ui';

/** What the board does on its own when a task is dropped into this column. */

interface ColumnBehaviorProps {
  column: BoardColumn;
  onPatch: (updates: Partial<BoardColumn>) => void;
}

export const ColumnBehavior: React.FC<ColumnBehaviorProps> = ({ column, onPatch }) => (
  <Surface level="s1" border="default" radius="lg" className="p-3.5 flex flex-col gap-2">
    <div className="flex items-center gap-1.5 mb-0.5">
      <Zap className="w-3.5 h-3.5 text-ink-3" />
      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Stage automation
      </span>
    </div>

    <ToggleRow
      checked={column.autoRun}
      disabled={!column.prompt.trim()}
      onChange={(checked) => onPatch({ autoRun: checked })}
      label="Run this prompt when an idle task is dropped here"
      description="A turn that is already running is not interrupted or queued — hit Run after it finishes if you want this prompt."
    />

    <ToggleRow
      checked={Boolean(column.compactOnEnter)}
      onChange={(checked) => onPatch({ compactOnEnter: checked })}
      label="Compact the session first when an idle task is dropped here"
      description="Summarizes the conversation so far, so the prompt above runs against a smaller context. Skipped while a turn is running."
    />

    <ToggleRow
      checked={Boolean(column.newSessionOnEnter)}
      onChange={(checked) => onPatch({ newSessionOnEnter: checked })}
      label="Start a fresh session when an idle task enters this stage"
      description="Archives the previous conversation into task session history and starts a clean session for this stage. A running session is left alone."
    />
  </Surface>
);
