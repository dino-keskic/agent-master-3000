import { useEffect, useState } from 'react';

/**
 * Current wall-clock timestamp (ms) that ticks only while `active` is true.
 * Leaves zero timers running when the owning session or task is idle.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);

  return now;
}
