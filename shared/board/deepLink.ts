/**
 * The `?task=TASK-123` deep link, and `?task=TASK-1,TASK-2` for a split view.
 *
 * Tasks are addressable so the drawer can be opened in its own tab and survive
 * a reload, split panels included. Both directions live here — reading the ids
 * out of a location, and working out the href that should replace it — so the
 * board only has to decide *when* the URL is out of step, not how to write it.
 */

export const TASK_PARAM = 'task';
export const SESSION_PARAM = 'session';

/** The tasks a location points at, left to right. Empty when there are none. */
export function taskIdsFromSearch(search: string): string[] {
  const raw = new URLSearchParams(search).get(TASK_PARAM) || '';
  const ids = raw.split(',').map((id) => id.trim()).filter(Boolean);
  return [...new Set(ids)];
}

/** The optional session id a deep link asks to focus, or undefined when absent. */
export function sessionIdFromSearch(search: string): string | undefined {
  const raw = new URLSearchParams(search).get(SESSION_PARAM)?.trim();
  return raw || undefined;
}

/**
 * The href `taskIds` should be at, or null when the current one already says
 * that — so the caller can skip a history write that changes nothing.
 */
export function hrefWithTasks(href: string, taskIds: readonly string[]): string | null {
  const url = new URL(href);
  const current = url.searchParams.get(TASK_PARAM) || '';
  const wanted = taskIds.join(',');
  if (current === wanted) return null;
  if (wanted) url.searchParams.set(TASK_PARAM, wanted);
  else url.searchParams.delete(TASK_PARAM);
  // Switching or closing tasks invalidates any session id that belonged to the previous deep link.
  url.searchParams.delete(SESSION_PARAM);
  // Task ids never contain a comma, so the separator can stay readable in the
  // address bar rather than turning into %2C.
  url.search = url.searchParams.toString().replace(/%2C/gi, ',');
  return url.toString();
}
