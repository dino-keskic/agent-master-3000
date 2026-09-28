import { notifications } from '@mantine/notifications';

/** Best-effort message for anything thrown — ApiError, Error, or a stray value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}

/**
 * One place that decides what a failed action looks like: a toast for the user
 * and a console entry for the developer. Replaces ~12 copies of
 * `catch (e) { console.error(...) }` that failed silently in the UI.
 */
export function reportError(title: string, error: unknown): void {
  console.error(`${title}:`, error);
  notifications.show({ title, message: errorMessage(error), color: 'red' });
}

export function notifySuccess(title: string, message: string): void {
  notifications.show({ title, message, color: 'accent' });
}
