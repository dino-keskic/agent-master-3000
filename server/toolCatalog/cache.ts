/**
 * The memory behind the tools panel.
 *
 * Reading OpenCode means starting a server and speaking MCP to every local
 * MCP server it has — seconds of work for an answer that changes when config
 * does. Keys start with the working directory they are about, so a directory
 * can be forgotten on its own: the panel's refresh button has one directory to
 * forget, not a whole map.
 */

/** Five minutes, unless a cache says otherwise. */
const CACHE_TTL_MS = 5 * 60_000;

export interface CwdCache<T> {
  /** Undefined when there is no entry, or the entry has aged out. */
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /** Drop one directory's entries, or all of them. */
  clear(cwd?: string): void;
}

/** Keys are a working directory, optionally with `::` and what varies under it. */
export function cwdCache<T>(ttlMs = CACHE_TTL_MS): CwdCache<T> {
  const entries = new Map<string, { at: number; value: T }>();
  return {
    get(key) {
      const hit = entries.get(key);
      return hit && Date.now() - hit.at < ttlMs ? hit.value : undefined;
    },
    set(key, value) {
      entries.set(key, { at: Date.now(), value });
    },
    clear(cwd) {
      if (!cwd) {
        entries.clear();
        return;
      }
      for (const key of entries.keys()) {
        if (key === cwd || key.startsWith(`${cwd}::`)) entries.delete(key);
      }
    }
  };
}
