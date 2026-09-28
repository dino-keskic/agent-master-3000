import React from 'react';
import { ActionIcon, Group, Select, TextInput, Tooltip } from '@mantine/core';
import { ArrowUpDown, Folder, RefreshCw, Search, X } from 'lucide-react';
import { ProjectFolder } from '../../../shared/types';
import { SessionSortOption } from '../../../shared/sessions/import';

/** Mantine's dark inputs, which the modal uses in three places. */
const INPUT_STYLE = {
  backgroundColor: 'rgb(var(--c-surface-2))',
  borderColor: 'rgb(var(--c-line-strong))',
  color: 'rgb(var(--c-ink))'
};

const SORT_OPTIONS: { value: SessionSortOption; label: string }[] = [
  { value: 'recent', label: 'Recent Activity' },
  { value: 'tokens', label: 'Most Tokens' },
  { value: 'cost', label: 'Highest Cost' },
  { value: 'changes', label: 'Most Changes' }
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
  <Group gap="sm" align="center" wrap="wrap">
    <TextInput
      size="sm"
      className="flex-1 min-w-[280px]"
      placeholder="Search sessions by title, model, or directory…"
      value={query}
      onChange={(e) => onQueryChange(e.target.value)}
      leftSection={<Search className="w-4 h-4 text-ink-2" />}
      rightSection={
        query ? (
          <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => onQueryChange('')}>
            <X className="w-3.5 h-3.5" />
          </ActionIcon>
        ) : null
      }
      styles={{ input: { ...INPUT_STYLE, fontSize: '13px' } }}
    />

    <Group gap="xs" wrap="nowrap">
      {projects.length > 1 && (
        <Select
          size="sm"
          aria-label="Project"
          value={projectId}
          data={[
            { value: ALL_PROJECTS, label: `All Projects (${projects.length})` },
            ...projects.map((p) => ({ value: p.id, label: p.name }))
          ]}
          onChange={(val) => val && onProjectChange(val)}
          allowDeselect={false}
          leftSection={<Folder className="w-3.5 h-3.5 text-accent" />}
          className="w-[180px]"
          styles={{ input: { ...INPUT_STYLE, fontSize: '12px' } }}
        />
      )}

      <Select
        size="sm"
        aria-label="Sort by"
        value={sortBy}
        data={SORT_OPTIONS}
        onChange={(val) => val && onSortChange(val as SessionSortOption)}
        allowDeselect={false}
        leftSection={<ArrowUpDown className="w-3.5 h-3.5 text-ink-2" />}
        className="w-[160px]"
        styles={{ input: { ...INPUT_STYLE, fontSize: '12px' } }}
      />

      <Tooltip label="Refresh sessions" withArrow>
        <ActionIcon variant="light" color="accent" size="lg" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </ActionIcon>
      </Tooltip>
    </Group>
  </Group>
);
