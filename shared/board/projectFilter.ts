/**
 * Which projects the board is showing.
 *
 * The board used to filter to the header's project unless you opted out, which
 * hid work you had not asked to hide. This is the opposite default: nothing is
 * filtered until you pick projects, and picking is multi-select, so two related
 * repos can be on screen together.
 */

import { ProjectFolder } from '../types.js';

/** Stands in for tasks that were never assigned to a project folder. */
export const UNASSIGNED_PROJECT = '__unassigned__';

export interface ProjectFilterChip {
  id: string;
  label: string;
  count: number;
  selected: boolean;
}

interface HasProject {
  projectId?: string;
}

function bucketOf(task: HasProject): string {
  return task.projectId || UNASSIGNED_PROJECT;
}

/** An empty selection is "no filter", not "nothing" — the board stays full. */
export function filterTasksByProjects<T extends HasProject>(tasks: T[], selected: string[]): T[] {
  if (selected.length === 0) return tasks;
  const wanted = new Set(selected);
  return tasks.filter((task) => wanted.has(bucketOf(task)));
}

export function projectTaskCounts(tasks: HasProject[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const key = bucketOf(task);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * One chip per project that has tasks, in the order the projects are
 * configured, with unassigned work last. A project you have selected keeps its
 * chip even after its last task leaves, so the filter cannot strand you on an
 * empty board with no way back.
 */
export function projectFilterChips(
  tasks: HasProject[],
  projects: ProjectFolder[],
  selected: string[]
): ProjectFilterChip[] {
  const counts = projectTaskCounts(tasks);
  const picked = new Set(selected);
  const chips: ProjectFilterChip[] = [];
  for (const project of projects) {
    const count = counts.get(project.id) || 0;
    if (count === 0 && !picked.has(project.id)) continue;
    chips.push({ id: project.id, label: project.name, count, selected: picked.has(project.id) });
  }
  const loose = counts.get(UNASSIGNED_PROJECT) || 0;
  if (loose > 0 || picked.has(UNASSIGNED_PROJECT)) {
    chips.push({
      id: UNASSIGNED_PROJECT,
      label: 'No project',
      count: loose,
      selected: picked.has(UNASSIGNED_PROJECT)
    });
  }
  return chips;
}

export function toggleProjectFilter(selected: string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/**
 * Drop ids that no longer name anything — a deleted project would otherwise
 * leave a filter on that matches no task and cannot be cleared from the bar.
 */
export function pruneProjectFilter(selected: string[], projects: ProjectFolder[]): string[] {
  const known = new Set<string>([UNASSIGNED_PROJECT, ...projects.map((project) => project.id)]);
  const kept = selected.filter((id) => known.has(id));
  return kept.length === selected.length ? selected : kept;
}
