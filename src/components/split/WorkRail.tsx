import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { workGroups } from '../../../shared/board/workList';
import { cardStatusLine, taskCardSummary } from '../../../shared/task/card';
import { SearchInput } from '../ui';
import './split.css';

/**
 * The board, folded into a list beside the open task.
 *
 * With a task open the columns are not on screen, so this is how you get to
 * the next one without going back: every task, grouped by whether it wants
 * something (`workGroups`), each with the same status line its card shows.
 */

interface WorkRailProps {
  tasks: BoardTask[];
  columns: BoardColumn[];
  openTaskIds: string[];
  focusedId?: string;
  /** Resized width in pixels; defaults to CSS 272px. */
  width?: number;
  onSelect: (task: BoardTask) => void;
  onBack: () => void;
}

export const WorkRail: React.FC<WorkRailProps> = ({
  tasks,
  columns,
  openTaskIds,
  focusedId,
  width,
  onSelect,
  onBack
}) => {
  const [query, setQuery] = useState('');

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(q) ||
        task.id.toLowerCase().includes(q) ||
        (task.projectName && task.projectName.toLowerCase().includes(q))
    );
  }, [tasks, query]);

  const groups = useMemo(() => workGroups(filteredTasks), [filteredTasks]);

  return (
    <nav
      className="work-rail"
      style={width ? { flexBasis: width, width } : undefined}
      aria-label="Tasks"
    >
      <button type="button" className="work-rail-back" onClick={onBack}>
        <ArrowLeft className="w-3.5 h-3.5" />
        Board
        <span className="kbd ml-auto">esc</span>
      </button>

      {tasks.length > 4 && (
        <div className="px-2.5 pt-2 pb-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Filter tasks…"
            containerClassName="w-full"
          />
        </div>
      )}

      <div className="work-rail-scroll">
        {groups.map((group) => (
          <section key={group.id}>
            <h3 className={`work-rail-group is-${group.id}`}>
              {group.title}
              <span>{group.tasks.length}</span>
            </h3>
            {group.tasks.map((task) => {
              const column = columns.find((col) => col.id === task.columnId);
              const summary = taskCardSummary(task, column);
              const status = cardStatusLine(task, summary);
              const open = openTaskIds.includes(task.id);
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`work-rail-row is-${status.tone}${open ? ' is-open' : ''}${
                    task.id === focusedId ? ' is-focused' : ''
                  }`}
                  aria-current={task.id === focusedId ? 'true' : undefined}
                  onClick={() => onSelect(task)}
                >
                  <span className="work-rail-dot" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="work-rail-meta">
                      <span className="font-mono font-semibold text-ink-4 shrink-0">{task.id}</span>
                      {column?.title && <span className="truncate">{column.title}</span>}
                    </span>
                    <span className="work-rail-title">{task.title}</span>
                    <span className="work-rail-status">
                      {status.text}
                      {summary.place ? ` · ${summary.place}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        ))}

        {groups.length === 0 && (
          <p className="m-0 px-3 py-6 text-center text-[12px] text-ink-4">
            No tasks match &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </nav>
  );
};
