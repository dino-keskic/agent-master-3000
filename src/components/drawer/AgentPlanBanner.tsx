import React, { useState } from 'react';
import { ChevronUp, Square } from 'lucide-react';
import { BoardTask, TaskLogItem } from '../../../shared/types';
import { extractTodoPlan } from '../../../shared/agent/todoPlan';
import { formatUsd } from '../../../shared/sessions/cost';
import { TodowriteChecklist } from './TodowriteChecklist';

interface AgentPlanBannerProps {
  task: BoardTask;
  logs?: TaskLogItem[];
  running: boolean;
  onStop: () => void | Promise<void>;
}

/**
 * Live "Working" status bar and agent plan indicator above the drawer footer.
 * Matches Agent Master 3000.dc.html (lines 706-724).
 */
export const AgentPlanBanner: React.FC<AgentPlanBannerProps> = ({
  task,
  logs,
  running,
  onStop
}) => {
  const [open, setOpen] = useState(false);
  const plan = extractTodoPlan(logs);

  if (!running && !plan) return null;

  const activeLabel = plan?.activeItem?.label || (running ? 'Executing turn…' : 'Plan completed');
  const stepCount = plan ? `${plan.activeStepNumber}/${plan.totalCount}` : undefined;
  const percent = plan ? plan.progressPercent : undefined;
  const costLabel = task.cost != null ? formatUsd(task.cost) : undefined;

  return (
    <div className="shrink-0 min-h-0 relative bg-run-bg border-t border-run-bd">
      <div
        onClick={() => {
          if (plan) setOpen((prev) => !prev);
        }}
        className={`flex items-center gap-2.5 px-4 py-2 select-none ${
          plan ? 'cursor-pointer hover:bg-surface-3/50' : ''
        }`}
      >
        {running && (
          <span className="relative flex w-2 h-2 shrink-0">
            <span className="pulse-ring" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-run" />
          </span>
        )}

        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.06em] text-run-fg shrink-0">
          {running ? 'Working' : 'Plan'}
        </span>

        <span className="text-[12.5px] font-medium text-ink flex-1 min-w-0 truncate">
          {activeLabel}
        </span>

        {stepCount && (
          <span className="font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-2 text-run-fg shrink-0">
            {stepCount}
          </span>
        )}

        {percent != null && (
          <span className="w-14 h-[3px] rounded-full bg-line overflow-hidden shrink-0">
            <span
              className="block h-full bg-run transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
        )}

        {costLabel && (
          <span className="font-mono text-[11px] text-ink-3 shrink-0 tabular-nums">
            {costLabel}
          </span>
        )}

        {running && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void onStop();
            }}
            className="inline-flex items-center gap-1.5 h-6 px-2.5 border-0 rounded-md bg-surface-2 text-ink-2 hover:text-err-fg text-xs font-medium cursor-pointer shrink-0 transition-colors"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            Interrupt
          </button>
        )}

        {plan && (
          <ChevronUp
            className={`w-3.5 h-3.5 text-ink-3 shrink-0 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
          />
        )}
      </div>

      {open && plan && <TodowriteChecklist plan={plan} />}
    </div>
  );
};
