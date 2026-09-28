import { useEffect, useMemo, useState } from 'react';
import { TaskChangeSummary } from '../../shared/git/changeSummary';
import {
  OPEN_TASK_VIEW,
  TaskViewFilter,
  countChangedFiles,
  countUpdatedToday,
  filterTasksForView,
  isUpdatedToday,
  startOfLocalDay,
  toggleTaskView
} from '../../shared/board/taskViewFilter';
import { BoardTask } from '../../shared/types';
import { useChangeSummaries } from '../components/card/useChangeSummaries';

/**
 * "Updated today" and "changed files", remembered across reloads.
 *
 * Applied on top of the project filter: the tasks passed in are already the
 * ones those chips left visible. The change read is the same one the cards
 * render, so a card and the filter cannot disagree about whether files changed.
 */

const TASK_VIEW_KEY = 'agentMasterTaskView';

function readView(): TaskViewFilter {
  try {
    const raw = window.localStorage.getItem(TASK_VIEW_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return OPEN_TASK_VIEW;
    const view = parsed as Partial<TaskViewFilter>;
    return { updatedToday: view.updatedToday === true, changedFiles: view.changedFiles === true };
  } catch {
    return OPEN_TASK_VIEW;
  }
}

export interface TaskViewChip {
  selected: boolean;
  /** Omitted while the count is not known yet — a badge of 0 would be a lie. */
  count?: number;
  title: string;
}

export interface TaskViewState {
  visibleTasks: BoardTask[];
  changes: Record<string, TaskChangeSummary>;
  updatedToday: TaskViewChip;
  changedFiles: TaskViewChip;
  toggleUpdatedToday: () => void;
  toggleChangedFiles: () => void;
}

export function useTaskViewFilter(tasks: BoardTask[]): TaskViewState {
  const [view, setView] = useState<TaskViewFilter>(readView);
  const { summaries, ready, failed } = useChangeSummaries(tasks);

  // Captured once, then moved forward when the local day does. Reading the
  // clock during render is impure, and a board left open past midnight should
  // not keep yesterday's "today" until the next reload.
  const [dayStart, setDayStart] = useState(() => startOfLocalDay(Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = startOfLocalDay(Date.now());
      setDayStart((current) => (current === next ? current : next));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      if (!view.updatedToday && !view.changedFiles) window.localStorage.removeItem(TASK_VIEW_KEY);
      else window.localStorage.setItem(TASK_VIEW_KEY, JSON.stringify(view));
    } catch {
      /* a board that cannot remember the filter still works */
    }
  }, [view]);

  const visibleTasks = useMemo(
    () => filterTasksForView(tasks, view, summaries, dayStart, ready, failed),
    [tasks, view, summaries, dayStart, ready, failed]
  );

  const todayCount = useMemo(() => {
    const base = view.changedFiles
      ? filterTasksForView(tasks, { updatedToday: false, changedFiles: true }, summaries, dayStart, ready, failed)
      : tasks;
    return countUpdatedToday(base, dayStart);
  }, [tasks, view.changedFiles, summaries, dayStart, ready, failed]);

  const changedCount = useMemo(() => {
    if (!ready) return undefined;
    const base = view.updatedToday ? tasks.filter((task) => isUpdatedToday(task.updatedAt, dayStart)) : tasks;
    return countChangedFiles(base, summaries);
  }, [tasks, view.updatedToday, summaries, dayStart, ready]);

  return {
    visibleTasks,
    changes: summaries,
    updatedToday: {
      selected: view.updatedToday,
      count: todayCount,
      title: 'Only tasks updated today'
    },
    changedFiles: {
      selected: view.changedFiles,
      count: changedCount,
      title: failed ? 'Could not read which files changed' : 'Only tasks with changed files'
    },
    toggleUpdatedToday: () => setView((current) => toggleTaskView(current, 'updatedToday')),
    toggleChangedFiles: () => setView((current) => toggleTaskView(current, 'changedFiles'))
  };
}
