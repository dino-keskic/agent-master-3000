/**
 * The index at the top of the Changes tab: every note on the task, in the
 * order a review is worked through, each as one plain-text line.
 */

import { ChangelogAuthor, ChangelogComment } from '../types.js';
import { DiffFile } from '../git/diff.js';
import { commentLocation, commentsInWorkspace, orphanedComments } from './changelogComments.js';

/** A comment as the index at the top of the Changes tab lists it. */
export interface CommentIndexEntry {
  id: string;
  location: string;
  /** The first line of the note, for a one-line row. */
  preview: string;
  author: ChangelogAuthor;
  resolved: boolean;
  replyCount: number;
  /** True when the note's file or line is no longer in the diff on screen. */
  orphaned: boolean;
  /** Which folder's diff the note is on, when the task works in several. */
  workspace?: string;
}

/**
 * A comment with its markdown taken off, line structure intact.
 *
 * Comment bodies are markdown — agents write lists, backticked paths and
 * links, and so do people. That renders in the thread, but in a one-line row
 * the syntax is just punctuation in the way, so the index and the collapsed
 * header read this instead.
 */
export function plainCommentText(body: string): string {
  return body
    .replace(/```[\s\S]*?(?:```|$)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+/gm, '')
    .replace(/^[ \t]*\d+[.)][ \t]+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![*\w])\*(?!\s)([^*\n]+)\*/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** The first line of a note, flattened, for anywhere one line is all there is. */
export function commentPreview(body: string, max = 140): string {
  const line = plainCommentText(body).split('\n').find((text) => text.trim() !== '')?.trim() || '';
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/**
 * Every note on the task, ordered the way someone works through a review:
 * open before resolved, then by file, then down the file. Without this the
 * only way to find a note is to scroll the whole diff looking for one.
 */
export function commentIndex(
  comments: ChangelogComment[] | undefined,
  files: DiffFile[]
): CommentIndexEntry[] {
  const list = comments || [];
  const orphans = new Set(orphanedComments(list, files).map((comment) => comment.id));
  return list
    .map((comment) => ({
      id: comment.id,
      location: commentLocation(comment),
      preview: commentPreview(comment.body),
      author: comment.author,
      resolved: !!comment.resolvedAt,
      replyCount: comment.replies.length,
      orphaned: orphans.has(comment.id)
    }))
    .sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      const [aPath, aLine] = splitLocation(a.location);
      const [bPath, bLine] = splitLocation(b.location);
      if (aPath !== bPath) return aPath.localeCompare(bPath);
      return aLine - bLine;
    });
}

function splitLocation(location: string): [string, number] {
  const match = /^(.*):(\d+)$/.exec(location);
  return match ? [match[1]!, Number(match[2])] : [location, 0];
}

/** One folder of a task, as the index needs to see it. */
export interface IndexedWorkspace {
  cwd: string;
  /** How the folder is named on screen — `workspaceTitle` of that workspace. */
  title: string;
  files: DiffFile[];
}

/**
 * The index over a task that works in several folders.
 *
 * Notes are grouped the way the diff below them is, and each row says which
 * folder it belongs to — without that, two notes on `src/index.ts` read as the
 * same file. A note carrying no folder is shown once, on the first folder whose
 * diff still has its line, so a note written before the task spread out does
 * not turn into one copy per repository.
 */
export function workspaceCommentIndex(
  comments: ChangelogComment[] | undefined,
  workspaces: IndexedWorkspace[]
): CommentIndexEntry[] {
  const list = comments || [];
  const named = workspaces.length > 1;
  const found = new Map<string, CommentIndexEntry>();

  for (const workspace of workspaces) {
    for (const entry of commentIndex(commentsInWorkspace(list, workspace.cwd), workspace.files)) {
      const previous = found.get(entry.id);
      if (previous && !(previous.orphaned && !entry.orphaned)) continue;
      found.set(entry.id, named ? { ...entry, workspace: workspace.title } : entry);
    }
  }

  // A note whose folder is not on the list at all — the session that wrote it
  // has since moved — is still the task's, and still has to be reachable.
  const elsewhere = list.filter(
    (comment) => comment.cwd && !workspaces.some((workspace) => workspace.cwd === comment.cwd)
  );
  for (const entry of commentIndex(elsewhere, [])) {
    if (!found.has(entry.id)) found.set(entry.id, entry);
  }

  return [...found.values()];
}
