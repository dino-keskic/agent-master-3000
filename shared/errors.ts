/**
 * Reading a thrown value without trusting its shape.
 *
 * `catch` hands over `unknown`: an `Error`, a child-process failure carrying
 * `stdout`/`stderr`/`code`, or whatever a library chose to throw. These are the
 * few questions the server asks of one, answered without an `any`.
 */

/** The message a thrown value carries, if it carries a non-empty one. */
export function errorMessage(e: unknown): string | undefined {
  const message = errorField(e, 'message');
  return message || undefined;
}

/**
 * A string property of a thrown value — `code`, `stdout`, `stderr` — or
 * undefined when it is missing or not a string.
 */
export function errorField(e: unknown, key: string): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const value = (e as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
