import { useEffect, useState } from 'react';
import { BoardLoadState, boardLoadState } from '../../../shared/board/load';

/**
 * The clock the loading decision needs, and nothing else.
 *
 * `shared/board/load.ts` is handed elapsed milliseconds so it can stay pure;
 * this is the only place that reads the wall clock for it. The ticker runs
 * only while the first load is still open — once it lands or fails, elapsed
 * time stops meaning anything and the interval is torn down.
 */

interface BoardLoadInputs {
  hasLoaded: boolean;
  loadError: string | null;
  isConnected: boolean;
}

/** Coarse enough to be free, fine enough to cross a 200ms threshold on time. */
const TICK_MS = 60;

export function useBoardLoadState({ hasLoaded, loadError, isConnected }: BoardLoadInputs): BoardLoadState {
  const [elapsedMs, setElapsedMs] = useState(0);
  const settled = hasLoaded || loadError != null;

  useEffect(() => {
    if (settled) return;
    // The clock is read inside the timer, never during a render. `Math.max`
    // keeps elapsed time monotonic when a retry restarts this effect: the user
    // has still been waiting since the first attempt.
    const startedAt = Date.now();
    const id = setInterval(() => {
      setElapsedMs((prev) => Math.max(prev, Date.now() - startedAt));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [settled]);

  return boardLoadState({ hasLoaded, loadError, isConnected, elapsedMs });
}
