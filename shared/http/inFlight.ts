/**
 * Joining a read that is already out, instead of starting it again.
 *
 * A poll that fires while its previous read is still out would otherwise start
 * another, and a slow read polled on a short timer piles up without bound.
 * In the browser each of those holds one of the six connections it allows a
 * host, and once they are all taken every other call waits behind them — an
 * answer to an agent's question sat for minutes behind a stack of spend reads.
 */

/** `start()`'s promise, or the one already out under `key`. Forgotten once it settles. */
export function joinInFlight<T>(inFlight: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const out = inFlight.get(key);
  if (out) return out;
  const started = start().finally(() => {
    if (inFlight.get(key) === started) inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}
