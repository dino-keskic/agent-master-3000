import React from 'react';
import { Tooltip } from '@mantine/core';
import { HelpCircle, Play, ShieldQuestion, Square } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { TaskCardSummary } from '../../../shared/task/card';
import { Button } from '../ui';

/**
 * The one button on a card, which is whichever of three the state calls for:
 * answer what is blocking it, stop what is running, or start it.
 *
 * Wrapped in a div that eats the click, because the whole card is a link and a
 * button press must not also open the task.
 */
export const CardAction: React.FC<{
  task: BoardTask;
  summary: TaskCardSummary;
  onSelect: (task: BoardTask) => void;
  onStop: (taskId: string) => void;
  onRun: (taskId: string) => void;
}> = ({ task, summary, onSelect, onStop, onRun }) => (
  <div
    className="shrink-0 relative z-[2]"
    onClick={(e) => {
      e.preventDefault();
      e.stopPropagation();
    }}
  >
    {summary.waiting ? (
      <Button
        size="xs"
        variant="wait"
        onClick={() => onSelect(task)}
        leftSection={
          task.pendingRequest?.type === 'question' ? (
            <HelpCircle className="w-3 h-3" />
          ) : (
            <ShieldQuestion className="w-3 h-3" />
          )
        }
      >
        Review
      </Button>
    ) : summary.running ? (
      <Button
        size="xs"
        variant="run"
        onClick={() => onStop(task.id)}
        leftSection={<Square className="w-3 h-3 fill-current" />}
      >
        Stop
      </Button>
    ) : (
      <Tooltip
        label={summary.folderGone ? 'Folder is gone — this worktree was deleted' : summary.runLabel}
        withArrow
      >
        <Button
          size="xs"
          variant="secondary"
          disabled={summary.folderGone}
          onClick={() => onRun(task.id)}
          leftSection={<Play className="w-3 h-3 fill-current" />}
        >
          {summary.runLabel}
        </Button>
      </Tooltip>
    )}
  </div>
);
