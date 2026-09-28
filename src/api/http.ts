/**
 * How the client talks to the server.
 *
 * Every call in `src/api/` goes through `request`, so error handling, JSON
 * encoding and the "server sent {error} with a non-2xx" convention are defined
 * exactly once instead of being re-implemented at each call site. The feature
 * files beside this one only say which path takes which body.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers
  });

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const del = <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' });

/**
 * The browser's locale and time zone, for the calls whose answer depends on
 * where "today" and "this week" start.
 */
export function localeQuery(): string {
  const params = new URLSearchParams();
  if (typeof navigator !== 'undefined' && navigator.language) {
    params.set('locale', navigator.language);
  }
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone) params.set('tz', timeZone);
  } catch {
    /* ignore */
  }
  return params.toString();
}
