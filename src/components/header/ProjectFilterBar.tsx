import React from 'react';
import { CalendarDays, FileDiff, Folder, FolderOpen, Layers } from 'lucide-react';
import { ProjectFilterChip } from '../../../shared/board/projectFilter';

/** One of the board-wide toggles beside the project chips. */
interface ViewChip {
  selected: boolean;
  /** Omitted while the count is not known yet. */
  count?: number;
  title: string;
}

interface ProjectFilterBarProps {
  chips: ProjectFilterChip[];
  total: number;
  /** True while at least one project chip is on, i.e. the board is showing a subset. */
  filtered: boolean;
  onToggle: (id: string) => void;
  onClear: () => void;
  updatedToday: ViewChip;
  changedFiles: ViewChip;
  onToggleUpdatedToday: () => void;
  onToggleChangedFiles: () => void;
}

interface FilterChipProps {
  label: string;
  count?: number;
  selected: boolean;
  icon: React.ReactNode;
  title?: string;
  onClick: () => void;
}

const FilterChip: React.FC<FilterChipProps> = ({ label, count, selected, icon, title, onClick }) => (
  <button
    type="button"
    aria-pressed={selected}
    title={title}
    onClick={onClick}
    className={`filter-chip${selected ? ' is-on' : ''}`}
  >
    {icon}
    <span className="max-w-[14rem] truncate">{label}</span>
    {count != null && <span className="filter-chip-count">{count}</span>}
  </button>
);

/**
 * What the board is narrowed to.
 *
 * Project chips are the session browser's shape: counted, multi-select, and
 * off means the whole board. "Updated today" and "Changed files" sit beside
 * them and stack — each is a single toggle, and neither clears the projects.
 */
export const ProjectFilterBar: React.FC<ProjectFilterBarProps> = ({
  chips,
  total,
  filtered,
  onToggle,
  onClear,
  updatedToday,
  changedFiles,
  onToggleUpdatedToday,
  onToggleChangedFiles
}) => {
  const showProjects = chips.length >= 2;

  return (
    <div className="filter-bar">
      {showProjects && (
        <>
          <span className="filter-bar-label type-meta">Projects</span>
          <FilterChip
            label="All"
            count={total}
            selected={!filtered}
            icon={<Layers className="w-3 h-3 shrink-0" />}
            onClick={onClear}
          />
          {chips.map((chip) => (
            <FilterChip
              key={chip.id}
              label={chip.label}
              count={chip.count}
              selected={chip.selected}
              icon={
                chip.selected ? (
                  <FolderOpen className="w-3 h-3 shrink-0" />
                ) : (
                  <Folder className="w-3 h-3 shrink-0" />
                )
              }
              onClick={() => onToggle(chip.id)}
            />
          ))}
          <span className="filter-bar-rule" aria-hidden />
        </>
      )}
      <span className="filter-bar-label type-meta">Show</span>
      <FilterChip
        label="Updated today"
        count={updatedToday.count}
        selected={updatedToday.selected}
        title={updatedToday.title}
        icon={<CalendarDays className="w-3 h-3 shrink-0" />}
        onClick={onToggleUpdatedToday}
      />
      <FilterChip
        label="Changed files"
        count={changedFiles.count}
        selected={changedFiles.selected}
        title={changedFiles.title}
        icon={<FileDiff className="w-3 h-3 shrink-0" />}
        onClick={onToggleChangedFiles}
      />
    </div>
  );
};
