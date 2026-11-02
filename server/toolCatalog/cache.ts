/**
 * The memory behind the tools panel.
 *
 * Reading OpenCode means starting a server and speaking MCP to every local
 * MCP server it has — seconds of work for an answer that changes when config
 * does. Keys start with the working directory they are about, so a directory
 * can be forgotten on its own: the panel's refresh button has one directory to
 * forget, not a whole map.
 *
 * An entry past its age is still an answer: `read` hands it back at once and
 * asks again behind it, so only a directory never read before — or one the
 * refresh button just forgot — waits for OpenCode to start.
 */

/** Five minutes, unless a cache says otherwise. */
const CACHE_TTL_MS = 5 * 60_000;

export interface CwdCache<T> {
  /**
   * The answer for `key`: fresh from memory; or what memory has, however old,
   * while `load` runs behind it; or, with nothing remembered, `load`'s. Callers
   * asking at once share one `load`.
   */
  read(key: string, load: () => Promise<T>): Promise<T>;
  /** Drop one directory's entries, or all of them. */
  clear(cwd?: string): void;
}

/** Keys are a working directory, optionally with `::` and what varies under it. */
export function cwdCache<T>(ttlMs = CACHE_TTL_MS): CwdCache<T> {
  const entries = new Map<string, { at: number; value: T }>();
  const loading = new Map<string, Promise<T>>();
  const forget = <V>(map: Map<string, V>, cwd: string) => {
    for (const key of map.keys()) {
      if (key === cwd || key.startsWith(`${cwd}::`)) map.delete(key);
    }
  };
  return {
    read(key, load) {
      const hit = entries.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
      let pending = loading.get(key);
      if (!pending) {
        const started: Promise<T> = load()
          .then((value) => {
            // A clear while this ran means it answers a question nobody asks now.
            if (loading.get(key) === started) entries.set(key, { at: Date.now(), value });
            return value;
          })
          .finally(() => {
            if (loading.get(key) === started) loading.delete(key);
          });
        loading.set(key, started);
        pending = started;
      }
      if (!hit) return pending;
      // Nobody waits on this one; a failure leaves the old answer standing.
      pending.catch(() => undefined);
      return Promise.resolve(hit.value);
    },
    clear(cwd) {
      if (!cwd) {
        entries.clear();
        loading.clear();
        return;
      }
      forget(entries, cwd);
      forget(loading, cwd);
    }
  };
}
