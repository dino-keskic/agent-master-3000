import { normalizeFolder } from '../board/projectPaths.js';

/**
 * Carrying a session over to the folder the board moved it to.
 *
 * OpenCode files a session under the folder it was created in, for good: every
 * request about it is routed there, whatever folder the client names. So a
 * session the board moves to a worktree would keep running its shell, relative
 * paths and git in the checkout it left. The only honest move is a new session
 * filed under the new folder, carrying the whole conversation — the same copy
 * a fork makes — which takes over from the old one on its next turn.
 */

/** True when the board runs a session somewhere OpenCode does not have it filed. */
export function sessionNeedsHandoff(boardFolder: string | undefined, openCodeFolder: string | undefined): boolean {
  const board = normalizeFolder(boardFolder);
  const filed = normalizeFolder(openCodeFolder);
  return !!board && !!filed && board !== filed;
}

/** What the task's log says about a handoff. */
export function handoffLog(title: string, from: string, to: string): string {
  return `Session "${title}" continues in ${normalizeFolder(to)}: its conversation was carried over to a new session there, `
    + `since OpenCode keeps a session in the folder it was created in (${normalizeFolder(from)}).`;
}
