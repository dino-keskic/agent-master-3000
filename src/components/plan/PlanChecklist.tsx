import React from 'react';
import { AlertCircle, Check, Circle, Play } from 'lucide-react';
import { TodoItem, TodoPlan } from '../../../shared/agent/todoPlan';

interface PlanChecklistProps {
  plan: TodoPlan;
  className?: string;
}

/**
 * Reusable checklist rendering an agent's `todowrite` plan.
 * Used both in the live AgentPlanBanner popup and inside tool call transcript bodies.
 * Matches Agent Master 3000.dc.html (lines 726-740).
 */
export const PlanChecklist: React.FC<PlanChecklistProps> = ({ plan, className = '' }) => {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2 py-1 px-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-4">
          Agent plan · todowrite
        </span>
        <div className="flex-1" />
        <span className="font-mono text-[10px] text-ink-4">
          {[
            plan.doneCount > 0 && `${plan.doneCount} done`,
            plan.runningCount > 0 && `${plan.runningCount} running`,
            plan.pendingCount > 0 && `${plan.pendingCount} pending`,
            plan.blockedCount > 0 && `${plan.blockedCount} blocked`
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {plan.items.map((item: TodoItem) => {
          const isDone = item.status === 'completed';
          const isRunning = item.status === 'in_progress';
          const isBlocked = item.status === 'blocked';

          return (
            <div
              key={item.id}
              className={`flex items-start gap-2.5 px-2 py-1 rounded-md transition-colors ${
                isRunning ? 'bg-run-bg' : 'hover:bg-surface-3/60'
              }`}
            >
              <span className="shrink-0 mt-0.5 w-3.5 flex items-center justify-center font-mono text-[11px] font-bold">
                {isDone ? (
                  <Check className="w-3 h-3 text-ok" />
                ) : isRunning ? (
                  <Play className="w-2.5 h-2.5 text-run-fg fill-current" />
                ) : isBlocked ? (
                  <AlertCircle className="w-3 h-3 text-wait-fg" />
                ) : (
                  <Circle className="w-2.5 h-2.5 text-ink-4" />
                )}
              </span>
              <span
                className={`flex-1 min-w-0 text-[12.5px] leading-[1.45] ${
                  isDone
                    ? 'text-ink-4 line-through'
                    : isRunning
                      ? 'text-ink font-medium'
                      : isBlocked
                        ? 'text-wait-fg'
                        : 'text-ink-2'
                }`}
              >
                {item.label}
              </span>
              {item.meta && (
                <span className="font-mono text-[9.5px] text-ink-4 shrink-0 mt-0.5">
                  {item.meta}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
