import React from 'react';
import { Tooltip } from '@mantine/core';
import { ArrowUpDown, Folder, RefreshCw } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { SessionSortOption } from '../../../shared/sessions/import';
import { InlineSelect, SearchInput, Surface } from '../ui';

const SORT_OPTIONS: { value: SessionSortOption; label: string }[] = [
  { value: 'recent', label: 'Recent activity' },
  { value: 'tokens', label: 'Most tokens' },
  { value: 'cost', label: 'Highest cost' },
  { value: 'changes', label: 'Most changes' }
];

/** Every project, plus the "no filter" entry the modal opens on. */
export const ALL_PROJECTS = '__ALL__';

interface SessionSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  projects: ProjectFolder[];
  projectId: string;
  onProjectChange: (value: string) => void;
  sortBy: SessionSortOption;
  onSortChange: (value: SessionSortOption) => void;
  isLoading: boolean;
  onRefresh: () => void;
}

/** What to look for, where to look, and in which order to show it. */
export const SessionSearchBar: React.FC<SessionSearchBarProps> = ({
  query,
  onQueryChange,
  projects,
  projectId,
  onProjectChange,
  sortBy,
  onSortChange,
  isLoading,
  onRefresh
}) => (
  <div className="flex items-center justify-between gap-2.5 flex-wrap">
    <SearchInput
      size="sm"
      value={query}
      onChange={onQueryChange}
      placeholder="Search sessions by title, model, or directory…"
      containerClassName="flex-1 min-w-[260px]"
    />

    <Surface level="s1" border="default" radius="md" className="flex items-center gap-2 px-2.5 py-0.5">
      {projects.length > 1 && (
        <>
          <InlineSelect
            label="Project"
            icon={<Folder className="w-3.5 h-3.5 text-acc-fg" />}
            value={projectId}
            options={[
              { value: ALL_PROJECTS, label: `All projects (${projects.length})` },
              ...projects.map((p) => ({ value: p.id, label: p.name }))
            ]}
            onChange={onProjectChange}
            searchable={projects.length > 8}
          />
          <span className="h-3.5 w-px bg-line" />
        </>
      )}

      <InlineSelect
        label="Sort by"
        icon={<ArrowUpDown className="w-3.5 h-3.5 text-ink-3" />}
        value={sortBy}
        options={SORT_OPTIONS}
        onChange={(val) => onSortChange(val as SessionSortOption)}
      />

      <span className="h-3.5 w-px bg-line" />

      <Tooltip label="Refresh sessions" withArrow>
        <button
          type="button"
          className="icon-btn w-7 h-7"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh sessions"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </Tooltip>
    </Surface>
  </div>
);
