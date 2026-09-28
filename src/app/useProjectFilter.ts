import { useEffect, useMemo, useState } from 'react';
import { BoardTask, ProjectFolder } from '../../shared/types';
import {
  ProjectFilterChip,
  filterTasksByProjects,
  projectFilterChips,
  pruneProjectFilter,
  toggleProjectFilter
} from '../../shared/board/projectFilter';

/**
 * Narrowing the board to some of its projects.
 *
 * The picker used to change only the cwd for *new* tasks while the board kept
 * showing every project at once. The choice is remembered across reloads, and
 * tasks with no project (imported sessions) stay visible so nothing disappears
 * without a way back.
 */

const PROJECT_FILTER_KEY = 'agentMasterProjectFilter';

function readProjectFilter(): string[] {
  try {
    const raw = window.localStorage.getItem(PROJECT_FILTER_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeProjectFilter(selected: string[]): void {
  try {
    if (selected.length === 0) window.localStorage.removeItem(PROJECT_FILTER_KEY);
    else window.localStorage.setItem(PROJECT_FILTER_KEY, JSON.stringify(selected));
  } catch {
    /* a board that cannot remember the filter still works */
  }
}

export interface BoardProjectFilter {
  visibleTasks: BoardTask[];
  chips: ProjectFilterChip[];
  isFiltered: boolean;
  toggle: (projectId: string) => void;
  clear: () => void;
}

export function useProjectFilter(tasks: BoardTask[], projects: ProjectFolder[]): BoardProjectFilter {
  const [stored, setSelected] = useState<string[]>(readProjectFilter);

  // A deleted project must not leave a filter on that nothing can satisfy.
  // Corrected while rendering rather than in an effect, so no frame is painted
  // filtered by a project that is gone; the same array comes back when there
  // is nothing to drop, which is what ends this.
  const selected = projects.length > 0 ? pruneProjectFilter(stored, projects) : stored;
  if (selected !== stored) setSelected(selected);

  useEffect(() => {
    writeProjectFilter(selected);
  }, [selected]);

  return {
    visibleTasks: useMemo(() => filterTasksByProjects(tasks, selected), [tasks, selected]),
    chips: useMemo(() => projectFilterChips(tasks, projects, selected), [tasks, projects, selected]),
    isFiltered: selected.length > 0,
    toggle: (projectId) => setSelected((current) => toggleProjectFilter(current, projectId)),
    clear: () => setSelected([])
  };
}
