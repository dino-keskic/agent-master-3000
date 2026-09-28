/**
 * Ids for log entries and other client-visible records.
 *
 * Replaces `Math.random().toString(36).substring(2)`, which appeared inline in
 * ten places and could collide (~36^11 but with a shared PRNG across a hot
 * streaming loop). randomUUID is available in Node 19+ and every target browser.
 */
export function newId(): string {
  return crypto.randomUUID();
}

/** Board URL for a task — cmd-click / open-in-new-tab target. */
export function taskHref(taskId: string): string {
  return `?task=${encodeURIComponent(taskId)}`;
}
