import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskSpendBreakdown } from '../../../shared/spend/types';
import { api } from '../../api';

/**
 * This task's spend breakdown, kept current while the task runs.
 *
 * It lives in the sidebar rather than in the section that prints it because
 * two figures show this money — the session's share and the task's total —
 * and they must come from the *same read*. Fetched on its own rather than carried on the
 * task: the read walks every message of every linked session and its
 * subagents, and the drawer must open before it finishes.
 */

/**
 * How often a running task's spend is re-read. The poll skips the server's
 * minute-long cache, which exists for the board and is exactly the staleness
 * that made the two figures disagree on screen.
 */
const POLL_MS = 10_000;

export interface TaskSpend {
  breakdown: TaskSpendBreakdown | null;
  loading: boolean;
}

export function useTaskSpend(taskId: string, running?: boolean): TaskSpend {
  const [breakdown, setBreakdown] = useState<TaskSpendBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const cancelled = useRef(false);
  const wasRunning = useRef(false);

  const load = useCallback(
    (fresh: boolean) =>
      api.getTaskSpend(taskId, fresh)
        .then((result) => {
          if (!cancelled.current) setBreakdown(result);
        })
        // A missing breakdown is not worth interrupting the user mid-task; the
        // section simply says nothing.
        .catch(() => {
          if (!cancelled.current) setBreakdown(null);
        }),
    [taskId]
  );

  // Opening the drawer, and every stage move, re-reads from scratch.
  useEffect(() => {
    cancelled.current = false;
    setBreakdown(null);
    setLoading(true);
    void load(false).finally(() => {
      if (!cancelled.current) setLoading(false);
    });
    return () => {
      cancelled.current = true;
    };
  }, [taskId, load]);

  useEffect(() => {
    if (!running) {
      // A turn just ended: the cached answer predates it, so this one read
      // skips the cache rather than reporting the total from a minute ago.
      // Only on the transition — on open the effect above has it covered.
      if (wasRunning.current) void load(true);
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    void load(true);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  return { breakdown, loading };
}
