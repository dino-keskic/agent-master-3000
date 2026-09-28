import { useEffect, useMemo, useRef, useState } from 'react';
import { TaskChangeSummary, mergeChangeSummaries, visibleChangeSummaries } from '../../../shared/git/changeSummary';
import { BoardTask } from '../../../shared/types';
import { api } from '../../api';

/**
 * The change summary behind every card on screen.
 *
 * One batched fetch for the whole board rather than one per card, refreshed
 * while a turn is in flight and once more when it ends — the same cadence as
 * the drawer's diff tab, minus the spinner. A failed refresh leaves the last
 * good values in place: this is background data, and a toast per failed poll
 * is how a notification panel fills up with noise.
 */

const LIVE_REFRESH_MS = 30_000;

/** A failed load is `undefined`: the caller keeps whatever it already shows. */
async function fetchSummaries(ids: string[]): Promise<Record<string, TaskChangeSummary> | undefined> {
  try {
    return (await api.getChangeSummaries(ids)).summaries;
  } catch {
    return undefined;
  }
}

export interface ChangeSummariesState {
  summaries: Record<string, TaskChangeSummary>;
  /** True once the fetch for the current tasks has succeeded. */
  ready: boolean;
  /** True when that fetch failed. The last good summaries stay put. */
  failed: boolean;
}

export function useChangeSummaries(tasks: BoardTask[]): ChangeSummariesState {
  const [summaries, setSummaries] = useState<Record<string, TaskChangeSummary>>({});
  const [fetchState, setFetchState] = useState<{ key: string; error: boolean } | null>(null);

  // The task array is a fresh snapshot on every websocket push. The fetch key
  // is the id set, so a status tick that changes no membership refetches
  // nothing.
  const idsKey = useMemo(() => tasks.map((task) => task.id).sort().join(','), [tasks]);
  const anyRunning = tasks.some((task) => task.runState === 'running');

  // Derived, never duplicated: entries for tasks that left the board are
  // pruned on the way out, so no effect has to reset this state.
  const ids = useMemo(() => idsKey.split(',').filter(Boolean), [idsKey]);
  const visible = useMemo(() => visibleChangeSummaries(summaries, ids), [summaries, ids]);
  const ready = ids.length === 0 || (fetchState?.key === idsKey && !fetchState.error);
  const failed = !!fetchState && fetchState.key === idsKey && fetchState.error;

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) return;
    void fetchSummaries(ids).then((next) => {
      if (cancelled) return;
      if (next) setSummaries((prev) => mergeChangeSummaries(prev, next));
      setFetchState({ key: idsKey, error: !next });
    });
    return () => {
      cancelled = true;
    };
  }, [ids, idsKey]);

  // Refreshed on a timer while a turn is in flight, and once more when it ends.
  const wasRunning = useRef(anyRunning);
  useEffect(() => {
    const refresh = () => {
      if (ids.length === 0) return;
      void fetchSummaries(ids).then((next) => {
        if (next) setSummaries((prev) => mergeChangeSummaries(prev, next));
      });
    };
    if (!anyRunning) {
      if (wasRunning.current) {
        wasRunning.current = false;
        refresh();
      }
      return;
    }
    wasRunning.current = true;
    const id = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [anyRunning, ids]);

  return { summaries: visible, ready, failed };
}
