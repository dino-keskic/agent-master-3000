/**
 * Local changelog comments — review notes on a task's Changes tab.
 *
 * They are stored on the task, not on GitHub. This is what a comment *is*:
 * building one, where it sits in a diff, and which ones are still open. Beside
 * it, `addressComments.ts` turns the open ones into a prompt,
 * `agentResponses.ts` reads the agent's replies back, `commentIndex.ts` lists
 * them for the top of the tab, and `changelogWrites.ts` puts them on the task.
 */

import { ChangelogAuthor, ChangelogComment, ChangelogReply } from '../types.js';
import { DiffFile, DiffLine } from '../git/diff.js';

export const MAX_COMMENT_BODY = 8_000;
export const MAX_COMMENT_SNIPPET = 500;

export function openChangelogComments(comments: ChangelogComment[] | undefined): ChangelogComment[] {
  return (comments || []).filter((comment) => !comment.resolvedAt);
}

export function clipCommentBody(body: string, max = MAX_COMMENT_BODY): string {
  const text = body.trim();
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * The DOM id the note's row carries. Shared so that whoever scrolls to a note
 * and whoever renders it cannot disagree about what to look for.
 */
export function commentRowId(commentId: string): string {
  return `changelog-comment-${commentId}`;
}

export function commentLocation(comment: ChangelogComment): string {
  if (comment.side === 'file' || (comment.newLine == null && comment.oldLine == null)) {
    return comment.path;
  }
  return `${comment.path}:${comment.newLine ?? comment.oldLine}`;
}

export function commentMatchesLine(comment: ChangelogComment, line: DiffLine): boolean {
  if (comment.side === 'file') return false;
  if (line.kind === 'del') {
    return comment.oldLine != null && comment.oldLine === line.oldLine;
  }
  return comment.newLine != null && comment.newLine === line.newLine;
}

export function commentsOnLine(
  comments: ChangelogComment[],
  path: string,
  line: DiffLine
): ChangelogComment[] {
  return comments.filter((comment) => comment.path === path && commentMatchesLine(comment, line));
}

export function commentsOnFile(comments: ChangelogComment[], path: string): ChangelogComment[] {
  return comments.filter((comment) => comment.path === path && comment.side === 'file');
}

/**
 * The notes that belong to one folder of a task that works in several.
 *
 * Two repositories can both have a `src/index.ts`, so a path alone stopped
 * being an answer. A note written before there was anything to disambiguate
 * carries no folder, and is shown in every one rather than disappearing from
 * the tab it was written on.
 */
export function commentsInWorkspace(
  comments: ChangelogComment[] | undefined,
  cwd: string
): ChangelogComment[] {
  return (comments || []).filter((comment) => !comment.cwd || comment.cwd === cwd);
}

function fileHasLine(file: DiffFile, comment: ChangelogComment): boolean {
  if (comment.side === 'file') return true;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (commentMatchesLine(comment, line)) return true;
    }
  }
  return false;
}

/**
 * Comments whose file is gone from the current diff, or whose line no longer
 * appears in it — still shown, just not inline.
 */
export function orphanedComments(comments: ChangelogComment[], files: DiffFile[]): ChangelogComment[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return comments.filter((comment) => {
    const file = byPath.get(comment.path);
    if (!file) return true;
    return !fileHasLine(file, comment);
  });
}

export interface NewChangelogComment {
  path: string;
  /** The folder the file is in, when the task works in more than one. */
  cwd?: string;
  newLine?: number;
  oldLine?: number;
  side: ChangelogComment['side'];
  snippet?: string;
  body: string;
}

export function buildChangelogComment(
  input: NewChangelogComment,
  id: string,
  now = Date.now()
): ChangelogComment | null {
  const path = input.path.trim();
  const body = clipCommentBody(input.body);
  if (!path || !body) return null;
  const cwd = (input.cwd || '').replace(/\/+$/, '').trim();
  return {
    id,
    path,
    cwd: cwd || undefined,
    newLine: input.newLine,
    oldLine: input.oldLine,
    side: input.side,
    snippet: (input.snippet || '').slice(0, MAX_COMMENT_SNIPPET),
    body,
    author: 'user',
    createdAt: now,
    replies: []
  };
}

export function buildChangelogReply(
  body: string,
  author: ChangelogAuthor,
  id: string,
  now = Date.now()
): ChangelogReply | null {
  const text = clipCommentBody(body);
  if (!text) return null;
  return { id, author: author === 'agent' ? 'agent' : 'user', body: text, createdAt: now };
}

export function countOpenAndResolved(comments: ChangelogComment[] | undefined): {
  open: number;
  resolved: number;
} {
  const list = comments || [];
  const resolved = list.filter((comment) => !!comment.resolvedAt).length;
  return { open: list.length - resolved, resolved };
}
