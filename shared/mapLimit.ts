/**
 * At most `limit` of `fn` in flight, results in input order.
 *
 * The board's git reads are cheap one at a time and ruinous as a herd:
 * dozens of `git status` against worktrees that share one object database.
 * Callers that shell out share this instead of `Promise.all`.
 */

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (items.length === 0 || limit <= 0) return results;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
