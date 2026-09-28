import { useCallback, useEffect, useState } from 'react';
import { SpendSummary } from '../../shared/spend/types';
import { api } from '../api';
import { reportError } from './notify';

/**
 * What the sessions have cost.
 *
 * This read walks OpenCode's message table, so it is never part of loading the
 * board: the board arrives first and the figure catches up, on a timer and
 * whenever the tab comes back.
 */

const SPEND_POLL_MS = 60_000;

export interface BoardSpend {
  spend: SpendSummary | null;
  isSpendLoading: boolean;
  /** `announce` is off for the background read: a figure that failed to arrive is not worth a toast. */
  refreshSpend: (announce?: boolean) => Promise<void>;
  /** Take the figure a board load already carried, instead of reading it twice. */
  seedSpend: (summary: SpendSummary) => void;
}

export function useSpend(): BoardSpend {
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [isSpendLoading, setIsSpendLoading] = useState(false);

  const refreshSpend = useCallback(async (announce = false) => {
    setIsSpendLoading(true);
    try {
      setSpend(await api.getSpend());
    } catch (e) {
      if (announce) reportError('Could not read spend', e);
    } finally {
      setIsSpendLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void refreshSpend(), SPEND_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshSpend]);

  return { spend, isSpendLoading, refreshSpend, seedSpend: setSpend };
}
