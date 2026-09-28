/**
 * What the screen should say while the board is coming up.
 *
 * The board has two independent liveness facts — whether the first
 * `GET /api/board` has landed, and whether the websocket is up — and only the
 * first one decides whether there is a board to look at. A socket that drops
 * after the data landed is a banner, never a curtain: the tasks on screen are
 * still true, they just stop ticking. Keeping that distinction here, rather
 * than in a `&&` inside a render, is the whole reason this module exists.
 *
 * Pure: it is handed elapsed milliseconds, never a clock.
 */

export type BoardLoadPhase =
  /** No board data yet, and no error: the first fetch is still in flight. */
  | 'loading'
  /** Data landed, socket is down. The board stays; it is only stale. */
  | 'reconnecting'
  /** The first fetch failed. Nothing to show but the reason and a retry. */
  | 'failed'
  /** Data landed and the feed is live. */
  | 'ready';

export interface BoardLoadInput {
  /** Has the first board fetch landed (successfully) at least once? */
  hasLoaded: boolean;
  /** The reason the last fetch failed, or null if it did not. */
  loadError: string | null;
  /** Is the websocket up right now? */
  isConnected: boolean;
  /** Milliseconds since the first fetch was started. */
  elapsedMs: number;
}

export interface BoardLoadState {
  phase: BoardLoadPhase;
  /** One line for the user: what is happening, or what went wrong. */
  message: string;
  /** May the board underneath be rendered? True as soon as data has landed. */
  showBoard: boolean;
  /** Should the full-screen loading state be on screen right now? */
  showLoadingScreen: boolean;
  /** Offer a retry button (only useful when there is nothing to look at). */
  canRetry: boolean;
}

/**
 * A first load faster than this never gets a loading screen at all. A spinner
 * that appears and vanishes within a frame or two reads as a flicker, and the
 * local API usually answers well inside this window; a blank canvas for a
 * fifth of a second is calmer than a flash.
 */
export const LOADING_REVEAL_MS = 200;

/** After this long the first load is worth explaining rather than just spinning. */
export const LOADING_SLOW_MS = 6000;

const CONNECTING = 'Connecting to the board…';
const SLOW = 'Still connecting — waiting for the board server.';
const RECONNECTING = 'Reconnecting to the live feed…';
const READY = 'Board is live.';

/** What the screen should be showing, from everything the board knows about itself. */
export function boardLoadState(input: BoardLoadInput): BoardLoadState {
  const { hasLoaded, loadError, isConnected, elapsedMs } = input;

  // Data first. Once tasks have landed, nothing below can take them off screen —
  // a later failed refresh or a dropped socket only makes them stale.
  if (hasLoaded) {
    return {
      phase: isConnected ? 'ready' : 'reconnecting',
      message: isConnected ? READY : RECONNECTING,
      showBoard: true,
      showLoadingScreen: false,
      canRetry: false
    };
  }

  if (loadError) {
    return {
      phase: 'failed',
      message: loadError,
      showBoard: false,
      // A failure is shown at once: the user is already waiting, and there is
      // no flicker to avoid once the outcome is known.
      showLoadingScreen: true,
      canRetry: true
    };
  }

  return {
    phase: 'loading',
    message: elapsedMs >= LOADING_SLOW_MS ? SLOW : CONNECTING,
    showBoard: false,
    showLoadingScreen: elapsedMs >= LOADING_REVEAL_MS,
    canRetry: false
  };
}

/**
 * The words next to the connection dot in the header.
 *
 * A first connect and a reconnect look the same to a socket but not to a
 * reader: "Connecting…" over a board full of tasks reads as though the tasks
 * are not real yet, when in fact only the live feed is missing.
 */
export function connectionLabel(phase: BoardLoadPhase): string {
  if (phase === 'ready') return 'Connected';
  if (phase === 'reconnecting') return 'Reconnecting…';
  return 'Connecting…';
}
