import { TOKEN_PARAM } from '../http/requestGuard.js';

/**
 * What the desktop app's window shows and where a click in it goes.
 *
 * The window is the board's own UI, served by the board process the app
 * starts. It may navigate within the board; anything else — a PR, a ticket, a
 * docs page — opens in the user's browser, so the window never becomes a
 * browser with the board's privileges. Wiring this to Electron is
 * `desktop/main.ts`.
 */

/** Where the desktop app's board listens. The installed CLI's port, so either can serve the same board. */
export const DESKTOP_PORT = 3737;

export function boardOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/**
 * The first page the window loads. With a token set the board refuses the
 * page itself, so the window arrives with a token link, which the board
 * trades for its cookie and a redirect to the clean address.
 */
export function boardWindowUrl(origin: string, token: string | undefined): string {
  const url = new URL('/', origin);
  if (token) url.searchParams.set(TOKEN_PARAM, token);
  return url.toString();
}

export type LinkTarget = 'board' | 'browser' | 'blocked';

/** Where a link the window is asked to open goes. */
export function linkTarget(href: string, origin: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return 'blocked';
  }
  if (url.origin === origin) return 'board';
  // Only what a browser is the right place for. A file: or custom-scheme link
  // from an agent's output is not something to hand the OS to open.
  return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? 'browser' : 'blocked';
}
