import React, { useState } from 'react';
import { Popover, ScrollArea, Tooltip } from '@mantine/core';
import { Columns2 } from 'lucide-react';
import { BoardTask } from '../../../shared/types';
import { splitCandidates } from '../../../shared/board/splitLayout';
import { SessionStateDot } from '../session/SessionStateDot';
import { Chip, SearchInput } from '../ui';

/**
 * "Open beside": pick another task to put in a panel next to this one.
 *
 * The board is under the workspace's overlay while a task is open, so a card
 * cannot be clicked from here — this list is how a second and third task get
 * on screen. Which tasks it offers, and in what order, is `splitCandidates`.
 */

interface SplitPickerProps {
  tasks: BoardTask[];
  openTaskIds: string[];
  /** No room for another panel: the pick replaces this one. */
  atCap: boolean;
  onPick: (taskId: string) => void;
}

export const SplitPicker: React.FC<SplitPickerProps> = ({ tasks, openTaskIds, atCap, onPick }) => {
  const [opened, setOpened] = useState(false);
  const [query, setQuery] = useState('');
  const candidates = opened ? splitCandidates(tasks, openTaskIds, query) : [];
  const label = atCap ? 'Replace this panel with another task' : 'Open another task beside this one';

  const close = () => {
    setOpened(false);
    setQuery('');
  };
  const pick = (taskId: string) => {
    close();
    onPick(taskId);
  };

  return (
    <Popover
      opened={opened}
      onChange={(next) => (next ? setOpened(true) : close())}
      position="bottom-end"
      width={380}
      shadow="md"
      trapFocus
      returnFocus={false}
    >
      <Popover.Target>
        <Tooltip label={label} withArrow disabled={opened}>
          <button
            type="button"
            className={`icon-btn${opened ? ' is-on' : ''}`}
            aria-label={label}
            aria-pressed={opened}
            onClick={() => (opened ? close() : setOpened(true))}
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </Popover.Target>

      <Popover.Dropdown p={8}>
        <div
          className="flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            close();
          }}
        >
          <SearchInput
            placeholder={atCap ? 'Replace with…' : 'Open beside…'}
            value={query}
            onChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && candidates[0]) {
                e.preventDefault();
                pick(candidates[0].id);
              }
            }}
            data-autofocus
            containerClassName="w-full"
          />
          <ScrollArea.Autosize mah={320} type="auto">
            {candidates.length === 0 ? (
              <p className="m-0 px-2 py-4 text-center text-[12px] text-ink-3">No other tasks match.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {candidates.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-s3h focus:bg-s3h focus:outline-none border-0 bg-transparent cursor-pointer transition-colors"
                    onClick={() => pick(task.id)}
                  >
                    <SessionStateDot state={task.runState} />
                    <Chip className="font-mono shrink-0">{task.id}</Chip>
                    <span className="text-[12.5px] font-medium text-ink truncate min-w-0">
                      {task.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea.Autosize>
        </div>
      </Popover.Dropdown>
    </Popover>
  );
};
