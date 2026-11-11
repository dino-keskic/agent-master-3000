import React from 'react';
import { Menu } from '@mantine/core';
import { CalendarDays, Check, ChevronDown, FileDiff, Folder, Layers } from 'lucide-react';
import { ProjectFilterChip, projectFilterLabel } from '../../../shared/board/projectFilter';

/**
 * What the board is narrowed to, as one switcher in the top bar.
 *
 * It replaces a row of chips that sat above the columns whether or not anyone
 * was filtering. Projects are multi-select and none means all of them; "Updated
 * today" and "Changed files" stack on top. The menu stays open while you tick,
 * since picking two projects is one thought.
 */

/** One of the board-wide toggles under the projects. */
export interface ViewToggle {
  selected: boolean;
  /** Omitted while the count is not known yet. */
  count?: number;
  title: string;
}

interface ViewMenuProps {
  chips: ProjectFilterChip[];
  total: number;
  onToggle: (id: string) => void;
  onClear: () => void;
  updatedToday: ViewToggle;
  changedFiles: ViewToggle;
  onToggleUpdatedToday: () => void;
  onToggleChangedFiles: () => void;
}

const Tick: React.FC<{ on: boolean }> = ({ on }) => (
  <Check className={`w-3.5 h-3.5 ${on ? 'text-acc-fg' : 'opacity-0'}`} />
);

const Count: React.FC<{ value?: number }> = ({ value }) =>
  value == null ? null : <span className="text-[12px] text-ink-3 tabular-nums">{value}</span>;

export const ViewMenu: React.FC<ViewMenuProps> = ({
  chips,
  total,
  onToggle,
  onClear,
  updatedToday,
  changedFiles,
  onToggleUpdatedToday,
  onToggleChangedFiles
}) => {
  const filtered = chips.some((chip) => chip.selected);
  const narrowed = filtered || updatedToday.selected || changedFiles.selected;
  const extras = [updatedToday.selected && 'today', changedFiles.selected && 'changed'].filter(Boolean).join(', ');

  return (
    <Menu shadow="md" position="bottom-start" withinPortal closeOnItemClick={false} width={260}>
      <Menu.Target>
        <button type="button" className={`hdr-btn topbar-view${narrowed ? ' is-narrowed' : ''}`} aria-label="Choose what the board shows">
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate max-w-[11rem]">{projectFilterLabel(chips)}</span>
          {extras && <span className="text-ink-3 font-normal">· {extras}</span>}
          <ChevronDown className="w-3 h-3 shrink-0 text-ink-3" />
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Projects</Menu.Label>
        <Menu.Item leftSection={<Tick on={!filtered} />} rightSection={<Count value={total} />} onClick={onClear}>
          All projects
        </Menu.Item>
        {chips.map((chip) => (
          <Menu.Item
            key={chip.id}
            leftSection={<Tick on={chip.selected} />}
            rightSection={<Count value={chip.count} />}
            onClick={() => onToggle(chip.id)}
          >
            <span className="inline-flex items-center gap-1.5 min-w-0">
              <Folder className="w-3 h-3 shrink-0 text-ink-3" />
              <span className="truncate">{chip.label}</span>
            </span>
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Label>Only show</Menu.Label>
        <Menu.Item
          leftSection={<Tick on={updatedToday.selected} />}
          rightSection={<Count value={updatedToday.count} />}
          title={updatedToday.title}
          onClick={onToggleUpdatedToday}
        >
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="w-3 h-3 text-ink-3" />
            Updated today
          </span>
        </Menu.Item>
        <Menu.Item
          leftSection={<Tick on={changedFiles.selected} />}
          rightSection={<Count value={changedFiles.count} />}
          title={changedFiles.title}
          onClick={onToggleChangedFiles}
        >
          <span className="inline-flex items-center gap-1.5">
            <FileDiff className="w-3 h-3 text-ink-3" />
            Changed files
          </span>
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
};
