import React from 'react';
import { TodoPlan } from '../../../shared/agent/todoPlan';
import { PlanChecklist } from '../plan/PlanChecklist';

interface TodowriteChecklistProps {
  plan: TodoPlan;
}

/**
 * Collapsible checklist popup for an agent plan (`todowrite`).
 * Matches the reference design in Agent Master 3000.dc.html (lines 726-740).
 */
export const TodowriteChecklist: React.FC<TodowriteChecklistProps> = ({ plan }) => {
  return (
    <div className="absolute bottom-full left-0 right-0 z-20 px-4 pt-1 pb-3 flex flex-col bg-surface border-t border-b border-run-bd shadow-[-10px_-26px_rgba(0,0,0,0.28)] max-h-[min(260px,calc(100vh-350px))] overflow-y-auto">
      <PlanChecklist plan={plan} />
    </div>
  );
};
