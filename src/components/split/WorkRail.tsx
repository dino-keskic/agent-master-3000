import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { BoardColumn, BoardTask } from '../../../shared/types';
import { workGroups } from '../../../shared/board/workList';
import { cardStatusLine, taskCardSummary } from '../../../shared/task/card';
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
  onSelect: (task: BoardTask) => void;
  onBack: () => void;
}

export const WorkRail: React.FC<WorkRailProps> = ({ tasks, columns, openTaskIds, focusedId, onSelect, onBack }) => (
  <nav className="work-rail" aria-label="Tasks">
    <button type="button" className="work-rail-back" onClick={onBack}>
      <ArrowLeft className="w-3.5 h-3.5" />
      Board
      <span className="kbd ml-auto">esc</span>
    </button>

    <div className="work-rail-scroll">
      {workGroups(tasks).map((group) => (
        <section key={group.id}>
          <h3 className={`work-rail-group is-${group.id}`}>
            {group.title}
            <span>{group.tasks.length}</span>
          </h3>
          {group.tasks.map((task) => {
            const summary = taskCardSummary(task, columns.find((column) => column.id === task.columnId));
            const status = cardStatusLine(task, summary);
            const open = openTaskIds.includes(task.id);
            return (
              <button
                key={task.id}
                type="button"
                className={`work-rail-row is-${status.tone}${open ? ' is-open' : ''}${task.id === focusedId ? ' is-focused' : ''}`}
                aria-current={task.id === focusedId ? 'true' : undefined}
                onClick={() => onSelect(task)}
              >
                <span className="work-rail-dot" aria-hidden />
                <span className="min-w-0 flex-1">
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
    </div>
  </nav>
);
