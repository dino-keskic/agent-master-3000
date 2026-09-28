/** What the agents cost: board-wide, and for one task. */

import { SpendSummary, TaskSpendBreakdown } from '../../shared/spend/types';
import { localeQuery, request } from './http';

export const spendApi = {
  /** Board-wide spend for today, this week and this month, broken down by model and project. */
  getSpend: () => {
    const q = localeQuery();
    return request<SpendSummary>(q ? `/api/spend?${q}` : '/api/spend');
  },

  /**
   * One task's spend, rolled up through its sessions and their subagents.
   * `fresh` skips the server's minute-long cache — for the read right after a
   * turn ends.
   */
  getTaskSpend: (taskId: string, fresh = false) =>
    request<TaskSpendBreakdown>(`/api/tasks/${taskId}/spend${fresh ? '?fresh=1' : ''}`)
};
