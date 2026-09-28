/**
 * When an unfinished turn in OpenCode's database is wreckage, not work.
 *
 * A turn that dies with its process leaves its last assistant message without
 * a `time.completed` and its tools `in_progress`, and every signal the
 * database has says "running" about it. The one thing a live turn does that a
 * dead one cannot is keep writing. This module holds that verdict, so the
 * board's DB probe (`server/opencode/liveTurns.ts`) and its tests agree on it.
 */

/**
 * The longest a live turn goes without writing anything into the database.
 *
 * A turn that is genuinely alive writes constantly: streamed text, reasoning,
 * tool output. Getting this wrong is cheap in one direction — the next poll
 * picks the session straight back up the moment anything is written — and
 * expensive in the other, a card in progress for a day with nothing behind it,
 * which is why the window is generous rather than tight.
 */
export const LIVE_TURN_SILENCE_MS = 15 * 60_000;

/**
 * Nobody can still be driving a turn last written at `lastWrite`.
 *
 * Silence is one way to know. The other is `boardStartedAt`: every turn the
 * board's own `opencode acp` child was running died with the board, since the
 * child goes with it — a Ctrl-C, a reinstall, a crash. Waiting out the silence
 * window for those would leave the card "running" for a quarter of an hour
 * after a restart, with no feed behind it and a composer that thinks the
 * session is busy. A turn driven from somewhere else (the OpenCode CLI) is
 * still writing, so it is back on the next poll after its first write.
 */
export function isAbandonedTurn(lastWrite: number | undefined, now: number, boardStartedAt = 0): boolean {
  const at = lastWrite ?? 0;
  if (now - at > LIVE_TURN_SILENCE_MS) return true;
  return at < boardStartedAt;
}
