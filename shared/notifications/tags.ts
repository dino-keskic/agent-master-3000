/**
 * Notification tags: the name one session's alert goes by, and the fresh tag
 * each banner is raised under so macOS alerts again instead of silently
 * rewriting the old one.
 */

export function notificationTag(taskId: string, sessionId?: string): string {
  return sessionId ? `agent-master-3000:${taskId}:${sessionId}` : `agent-master-3000:${taskId}`;
}

/**
 * A tag macOS will alert on.
 *
 * Reusing a tag does not re-announce: Notification Center rewrites the
 * notification already sitting there, and `renotify` does not change that on
 * macOS. A fresh tag is a new banner. `seq` splits two alerts in the same
 * millisecond; `now` splits them across reloads, where `seq` would start over
 * and collide with a banner still on screen.
 */
export function freshNotificationTag(logicalTag: string, now: number, seq: number): string {
  return `${logicalTag}:${now.toString(36)}:${seq}`;
}

/**
 * Whether an on-screen notification is the one `wanted` names.
 *
 * `shownTag` may be the logical tag (alerts raised before fresh tags existed)
 * or a fresh tag hanging off it. The extra colon is what keeps `TASK-1` from
 * matching `TASK-10`. `exceptTag` is the banner just raised, which must not be
 * closed in the same breath.
 */
export function notificationTagMatches(
  shownTag: string,
  logicalTag: string | undefined,
  wanted: string,
  exceptTag?: string
): boolean {
  if (exceptTag && shownTag === exceptTag) return false;
  if (logicalTag === wanted || shownTag === wanted) return true;
  return shownTag.startsWith(`${wanted}:`);
}

/** One inbox row (and one desktop tag) per session. */
export function sessionInboxKey(taskId: string, sessionId?: string): string {
  return `session:${taskId}:${sessionId || ''}`;
}
